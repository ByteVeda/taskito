//! Shared schema-migration DDL for the SQLite and Postgres backends.
//!
//! Both backends create the same logical schema; only column types and the
//! `ALTER TABLE ... ADD COLUMN` syntax differ. This module renders the DDL
//! once and substitutes per-backend type names through a [`Dialect`] table.
//!
//! Each backend's `run_migrations()` walks the three lists in order:
//!
//! 1. [`create_tables`] — `CREATE TABLE IF NOT EXISTS …`
//! 2. [`create_indexes`] — index DDL that is identical across both backends
//! 3. [`alter_statements`] — backfill `ALTER TABLE … ADD COLUMN …` for
//!    databases that pre-date a column. The backend supplies its own
//!    executor: SQLite swallows "duplicate column" errors, while Postgres
//!    relies on `IF NOT EXISTS` and surfaces other failures as warnings.

/// Per-backend type-name substitutions used to render shared DDL templates.
pub struct Dialect {
    /// Binary blob column type. SQLite: `BLOB`. Postgres: `BYTEA`.
    pub binary: &'static str,
    /// 64-bit integer column type. SQLite: `INTEGER`. Postgres: `BIGINT`.
    pub big_int: &'static str,
    /// Boolean column rendering with a default-true clause. SQLite stores
    /// booleans as `INTEGER`; Postgres uses `BOOLEAN`.
    pub boolean_default_true: &'static str,
    /// Boolean column rendering with a default-false clause.
    pub boolean_default_false: &'static str,
    /// Floating-point column type. SQLite: `REAL`. Postgres: `DOUBLE PRECISION`.
    pub real: &'static str,
    /// Prefix inserted between `ADD COLUMN` and the column name on
    /// `ALTER TABLE` migrations. Empty for SQLite (which lacks the syntax);
    /// `"IF NOT EXISTS "` for Postgres.
    pub alter_if_not_exists: &'static str,
}

// Each Dialect is only referenced from its own backend module, so only
// one of these constants is reachable under any given cargo-feature set.
// The unused-constant warning is silenced rather than wrapping each
// constant in cargo-feature cfgs because the type itself is identical
// across backends.
#[allow(dead_code)]
pub const SQLITE: Dialect = Dialect {
    binary: "BLOB",
    big_int: "INTEGER",
    boolean_default_true: "INTEGER NOT NULL DEFAULT 1",
    boolean_default_false: "INTEGER NOT NULL DEFAULT 0",
    real: "REAL",
    alter_if_not_exists: "",
};

#[allow(dead_code)]
pub const POSTGRES: Dialect = Dialect {
    binary: "BYTEA",
    big_int: "BIGINT",
    boolean_default_true: "BOOLEAN NOT NULL DEFAULT TRUE",
    boolean_default_false: "BOOLEAN NOT NULL DEFAULT FALSE",
    real: "DOUBLE PRECISION",
    alter_if_not_exists: "IF NOT EXISTS ",
};

/// `CREATE TABLE IF NOT EXISTS` statements in dependency-safe creation order.
///
/// Returns owned strings — the dialect substitutes type names at call time.
pub fn create_tables(d: &Dialect) -> Vec<String> {
    let bin = d.binary;
    let bi = d.big_int;
    let real = d.real;
    let bool_true = d.boolean_default_true;
    let bool_false = d.boolean_default_false;

    vec![
        format!(
            "CREATE TABLE IF NOT EXISTS jobs (
                id           TEXT PRIMARY KEY,
                queue        TEXT NOT NULL DEFAULT 'default',
                task_name    TEXT NOT NULL,
                payload      {bin} NOT NULL,
                status       INTEGER NOT NULL DEFAULT 0,
                priority     INTEGER NOT NULL DEFAULT 0,
                created_at   {bi} NOT NULL,
                scheduled_at {bi} NOT NULL,
                started_at   {bi},
                completed_at {bi},
                retry_count  INTEGER NOT NULL DEFAULT 0,
                max_retries  INTEGER NOT NULL DEFAULT 3,
                result       {bin},
                error        TEXT,
                timeout_ms   {bi} NOT NULL DEFAULT 300000,
                unique_key   TEXT,
                progress     INTEGER,
                metadata     TEXT,
                cancel_requested INTEGER NOT NULL DEFAULT 0,
                expires_at   {bi},
                result_ttl_ms {bi}
            )"
        ),
        format!(
            "CREATE TABLE IF NOT EXISTS dead_letter (
                id              TEXT PRIMARY KEY,
                original_job_id TEXT NOT NULL,
                queue           TEXT NOT NULL,
                task_name       TEXT NOT NULL,
                payload         {bin} NOT NULL,
                error           TEXT,
                retry_count     INTEGER NOT NULL,
                failed_at       {bi} NOT NULL,
                metadata        TEXT,
                priority        INTEGER NOT NULL DEFAULT 0,
                max_retries     INTEGER NOT NULL DEFAULT 3,
                timeout_ms      {bi} NOT NULL DEFAULT 300000,
                result_ttl_ms   {bi}
            )"
        ),
        format!(
            "CREATE TABLE IF NOT EXISTS rate_limits (
                key         TEXT PRIMARY KEY,
                tokens      {real} NOT NULL,
                max_tokens  {real} NOT NULL,
                refill_rate {real} NOT NULL,
                last_refill {bi} NOT NULL
            )"
        ),
        format!(
            "CREATE TABLE IF NOT EXISTS periodic_tasks (
                name        TEXT PRIMARY KEY,
                task_name   TEXT NOT NULL,
                cron_expr   TEXT NOT NULL,
                args        {bin},
                kwargs      {bin},
                queue       TEXT NOT NULL DEFAULT 'default',
                enabled     {bool_true},
                last_run    {bi},
                next_run    {bi} NOT NULL
            )"
        ),
        format!(
            "CREATE TABLE IF NOT EXISTS job_errors (
                id        TEXT PRIMARY KEY,
                job_id    TEXT NOT NULL,
                attempt   INTEGER NOT NULL,
                error     TEXT NOT NULL,
                failed_at {bi} NOT NULL
            )"
        ),
        "CREATE TABLE IF NOT EXISTS job_dependencies (
                id                TEXT PRIMARY KEY,
                job_id            TEXT NOT NULL,
                depends_on_job_id TEXT NOT NULL
            )"
        .to_string(),
        format!(
            "CREATE TABLE IF NOT EXISTS task_metrics (
                id           TEXT PRIMARY KEY,
                task_name    TEXT NOT NULL,
                job_id       TEXT NOT NULL,
                wall_time_ns {bi} NOT NULL,
                memory_bytes {bi} NOT NULL DEFAULT 0,
                succeeded    {bool_true},
                recorded_at  {bi} NOT NULL
            )"
        ),
        format!(
            "CREATE TABLE IF NOT EXISTS replay_history (
                id               TEXT PRIMARY KEY,
                original_job_id  TEXT NOT NULL,
                replay_job_id    TEXT NOT NULL,
                replayed_at      {bi} NOT NULL,
                original_result  {bin},
                replay_result    {bin},
                original_error   TEXT,
                replay_error     TEXT
            )"
        ),
        format!(
            "CREATE TABLE IF NOT EXISTS task_logs (
                id         TEXT PRIMARY KEY,
                job_id     TEXT NOT NULL,
                task_name  TEXT NOT NULL,
                level      TEXT NOT NULL DEFAULT 'info',
                message    TEXT NOT NULL,
                extra      TEXT,
                logged_at  {bi} NOT NULL
            )"
        ),
        format!(
            "CREATE TABLE IF NOT EXISTS circuit_breakers (
                task_name      TEXT PRIMARY KEY,
                state          INTEGER NOT NULL DEFAULT 0,
                failure_count  INTEGER NOT NULL DEFAULT 0,
                last_failure_at {bi},
                opened_at      {bi},
                half_open_at   {bi},
                threshold      INTEGER NOT NULL DEFAULT 5,
                window_ms      {bi} NOT NULL DEFAULT 60000,
                cooldown_ms    {bi} NOT NULL DEFAULT 300000,
                half_open_max_probes   INTEGER NOT NULL DEFAULT 5,
                half_open_success_rate {real} NOT NULL DEFAULT 0.8,
                half_open_probe_count  INTEGER NOT NULL DEFAULT 0,
                half_open_success_count INTEGER NOT NULL DEFAULT 0,
                half_open_failure_count INTEGER NOT NULL DEFAULT 0
            )"
        ),
        format!(
            "CREATE TABLE IF NOT EXISTS workers (
                worker_id      TEXT PRIMARY KEY,
                last_heartbeat {bi} NOT NULL,
                queues         TEXT NOT NULL DEFAULT 'default',
                status         TEXT NOT NULL DEFAULT 'active'
            )"
        ),
        format!(
            "CREATE TABLE IF NOT EXISTS queue_state (
                queue_name TEXT PRIMARY KEY,
                paused     {bool_false},
                paused_at  {bi}
            )"
        ),
        format!(
            "CREATE TABLE IF NOT EXISTS archived_jobs (
                id           TEXT PRIMARY KEY,
                queue        TEXT NOT NULL DEFAULT 'default',
                task_name    TEXT NOT NULL,
                payload      {bin} NOT NULL,
                status       INTEGER NOT NULL DEFAULT 0,
                priority     INTEGER NOT NULL DEFAULT 0,
                created_at   {bi} NOT NULL,
                scheduled_at {bi} NOT NULL,
                started_at   {bi},
                completed_at {bi},
                retry_count  INTEGER NOT NULL DEFAULT 0,
                max_retries  INTEGER NOT NULL DEFAULT 3,
                result       {bin},
                error        TEXT,
                timeout_ms   {bi} NOT NULL DEFAULT 300000,
                unique_key   TEXT,
                progress     INTEGER,
                metadata     TEXT,
                cancel_requested INTEGER NOT NULL DEFAULT 0,
                expires_at   {bi},
                result_ttl_ms {bi}
            )"
        ),
        format!(
            "CREATE TABLE IF NOT EXISTS distributed_locks (
                lock_name   TEXT PRIMARY KEY,
                owner_id    TEXT NOT NULL,
                acquired_at {bi} NOT NULL,
                expires_at  {bi} NOT NULL
            )"
        ),
        format!(
            "CREATE TABLE IF NOT EXISTS execution_claims (
                job_id     TEXT PRIMARY KEY,
                worker_id  TEXT NOT NULL,
                claimed_at {bi} NOT NULL
            )"
        ),
        format!(
            "CREATE TABLE IF NOT EXISTS dashboard_settings (
                key        TEXT PRIMARY KEY,
                value      TEXT NOT NULL,
                updated_at {bi} NOT NULL
            )"
        ),
    ]
}

/// `CREATE INDEX IF NOT EXISTS` statements — identical across both backends.
pub fn create_indexes() -> &'static [&'static str] {
    &[
        "CREATE INDEX IF NOT EXISTS idx_jobs_dequeue
                ON jobs(queue, status, priority DESC, scheduled_at)",
        "CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_unique_key
                ON jobs(unique_key) WHERE unique_key IS NOT NULL AND status IN (0, 1)",
        "CREATE INDEX IF NOT EXISTS idx_job_errors_job_id ON job_errors(job_id)",
        "CREATE INDEX IF NOT EXISTS idx_job_deps_job_id ON job_dependencies(job_id)",
        "CREATE INDEX IF NOT EXISTS idx_job_deps_depends_on ON job_dependencies(depends_on_job_id)",
        "CREATE INDEX IF NOT EXISTS idx_task_metrics_task_name ON task_metrics(task_name)",
        "CREATE INDEX IF NOT EXISTS idx_task_metrics_recorded_at ON task_metrics(recorded_at)",
        "CREATE INDEX IF NOT EXISTS idx_replay_original ON replay_history(original_job_id)",
        "CREATE INDEX IF NOT EXISTS idx_task_logs_job_id ON task_logs(job_id)",
        "CREATE INDEX IF NOT EXISTS idx_task_logs_recorded ON task_logs(logged_at)",
        "CREATE INDEX IF NOT EXISTS idx_archived_jobs_completed ON archived_jobs(completed_at)",
        "CREATE INDEX IF NOT EXISTS idx_distributed_locks_expires ON distributed_locks(expires_at)",
        "CREATE INDEX IF NOT EXISTS idx_execution_claims_claimed ON execution_claims(claimed_at)",
    ]
}

/// `ALTER TABLE … ADD COLUMN …` statements used to backfill schemas that
/// pre-date a column. Each backend supplies its own executor that handles
/// "column already exists" idempotently.
pub fn alter_statements(d: &Dialect) -> Vec<String> {
    let bi = d.big_int;
    let real = d.real;
    let ife = d.alter_if_not_exists;

    vec![
        // jobs ── cancel_requested / expires_at / result_ttl_ms
        format!("ALTER TABLE jobs ADD COLUMN {ife}cancel_requested INTEGER NOT NULL DEFAULT 0"),
        format!("ALTER TABLE jobs ADD COLUMN {ife}expires_at {bi}"),
        format!("ALTER TABLE jobs ADD COLUMN {ife}result_ttl_ms {bi}"),
        // dead_letter retry / timeout / ttl backfill
        format!("ALTER TABLE dead_letter ADD COLUMN {ife}priority INTEGER NOT NULL DEFAULT 0"),
        format!("ALTER TABLE dead_letter ADD COLUMN {ife}max_retries INTEGER NOT NULL DEFAULT 3"),
        format!(
            "ALTER TABLE dead_letter ADD COLUMN {ife}timeout_ms {bi} NOT NULL DEFAULT 300000"
        ),
        format!("ALTER TABLE dead_letter ADD COLUMN {ife}result_ttl_ms {bi}"),
        // workers metadata backfill
        format!("ALTER TABLE workers ADD COLUMN {ife}tags TEXT"),
        format!("ALTER TABLE workers ADD COLUMN {ife}resources TEXT"),
        format!("ALTER TABLE workers ADD COLUMN {ife}resource_health TEXT"),
        format!("ALTER TABLE workers ADD COLUMN {ife}threads INTEGER NOT NULL DEFAULT 0"),
        format!("ALTER TABLE workers ADD COLUMN {ife}started_at {bi}"),
        format!("ALTER TABLE workers ADD COLUMN {ife}hostname TEXT"),
        format!("ALTER TABLE workers ADD COLUMN {ife}pid INTEGER"),
        format!("ALTER TABLE workers ADD COLUMN {ife}pool_type TEXT"),
        // periodic_tasks timezone
        format!("ALTER TABLE periodic_tasks ADD COLUMN {ife}timezone TEXT"),
        // jobs namespace
        format!("ALTER TABLE jobs ADD COLUMN {ife}namespace TEXT"),
        // sample-based half-open circuit-breaker probe counters
        format!(
            "ALTER TABLE circuit_breakers ADD COLUMN {ife}half_open_max_probes INTEGER NOT NULL DEFAULT 5"
        ),
        format!(
            "ALTER TABLE circuit_breakers ADD COLUMN {ife}half_open_success_rate {real} NOT NULL DEFAULT 0.8"
        ),
        format!(
            "ALTER TABLE circuit_breakers ADD COLUMN {ife}half_open_probe_count INTEGER NOT NULL DEFAULT 0"
        ),
        format!(
            "ALTER TABLE circuit_breakers ADD COLUMN {ife}half_open_success_count INTEGER NOT NULL DEFAULT 0"
        ),
        format!(
            "ALTER TABLE circuit_breakers ADD COLUMN {ife}half_open_failure_count INTEGER NOT NULL DEFAULT 0"
        ),
        // namespace backfill on dead_letter / archived_jobs (after circuit-breaker columns)
        format!("ALTER TABLE dead_letter ADD COLUMN {ife}namespace TEXT"),
        format!("ALTER TABLE archived_jobs ADD COLUMN {ife}namespace TEXT"),
    ]
}
