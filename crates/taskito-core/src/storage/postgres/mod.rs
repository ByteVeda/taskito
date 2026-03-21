mod archival;
mod circuit_breakers;
mod dead_letter;
mod jobs;
mod locks;
mod logs;
mod metrics;
mod periodic;
mod queue_state;
mod rate_limits;
mod trait_impl;
mod workers;

use diesel::pg::PgConnection;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};

use crate::error::Result;

/// Run an ALTER TABLE migration, logging a warning on any failure.
/// Postgres migrations use IF NOT EXISTS, so any error is genuinely unexpected.
fn migration_alter(conn: &mut PgConnection, sql: &str) {
    if let Err(e) = diesel::sql_query(sql).execute(conn) {
        log::warn!("migration failed for '{sql}': {e}");
    }
}

type PgPool = Pool<ConnectionManager<PgConnection>>;

/// Validate a PostgreSQL schema name (alphanumeric + underscores, non-empty).
fn validate_schema_name(schema: &str) -> Result<()> {
    if schema.is_empty() {
        return Err(crate::error::QueueError::Config(
            "Schema name cannot be empty".into(),
        ));
    }
    if !schema
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_')
    {
        return Err(crate::error::QueueError::Config(
            format!("Invalid schema name '{schema}': only alphanumeric characters and underscores are allowed"),
        ));
    }
    Ok(())
}

/// PostgreSQL-backed storage for the task queue, using Diesel ORM.
#[derive(Clone)]
pub struct PostgresStorage {
    pool: PgPool,
    schema: String,
}

impl PostgresStorage {
    /// Connect to a PostgreSQL database at the given URL.
    /// Tables are created in the `taskito` schema by default.
    pub fn new(database_url: &str) -> Result<Self> {
        Self::with_schema(database_url, "taskito")
    }

    /// Connect with a custom schema name.
    pub fn with_schema(database_url: &str, schema: &str) -> Result<Self> {
        Self::build(database_url, 10, schema)
    }

    /// Connect with a custom connection pool size and schema.
    pub fn with_pool_size(database_url: &str, pool_size: u32) -> Result<Self> {
        Self::build(database_url, pool_size, "taskito")
    }

    /// Connect with a custom schema name and connection pool size.
    pub fn with_schema_and_pool_size(
        database_url: &str,
        schema: &str,
        pool_size: u32,
    ) -> Result<Self> {
        Self::build(database_url, pool_size, schema)
    }

    fn build(database_url: &str, pool_size: u32, schema: &str) -> Result<Self> {
        validate_schema_name(schema)?;

        let manager = ConnectionManager::<PgConnection>::new(database_url);
        let pool = Pool::builder()
            .max_size(pool_size)
            .min_idle(Some(1))
            .idle_timeout(Some(std::time::Duration::from_secs(300)))
            .max_lifetime(Some(std::time::Duration::from_secs(1800)))
            .connection_timeout(std::time::Duration::from_secs(10))
            .build(manager)?;

        let storage = Self {
            pool,
            schema: schema.to_string(),
        };
        storage.run_migrations()?;
        Ok(storage)
    }

    pub(crate) fn conn(
        &self,
    ) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<PgConnection>>> {
        let mut conn = self.pool.get()?;
        diesel::sql_query(format!("SET search_path TO {}", self.schema))
            .execute(&mut conn)
            .map_err(crate::error::QueueError::Storage)?;
        Ok(conn)
    }

    fn run_migrations(&self) -> Result<()> {
        let mut conn = self.conn()?;

        // Ensure the schema exists before creating tables
        diesel::sql_query(format!("CREATE SCHEMA IF NOT EXISTS {}", self.schema))
            .execute(&mut conn)?;

        // Use PG-native types: TEXT, BYTEA, BIGINT, INTEGER, BOOLEAN, DOUBLE PRECISION
        diesel::sql_query(
            "CREATE TABLE IF NOT EXISTS jobs (
                id           TEXT PRIMARY KEY,
                queue        TEXT NOT NULL DEFAULT 'default',
                task_name    TEXT NOT NULL,
                payload      BYTEA NOT NULL,
                status       INTEGER NOT NULL DEFAULT 0,
                priority     INTEGER NOT NULL DEFAULT 0,
                created_at   BIGINT NOT NULL,
                scheduled_at BIGINT NOT NULL,
                started_at   BIGINT,
                completed_at BIGINT,
                retry_count  INTEGER NOT NULL DEFAULT 0,
                max_retries  INTEGER NOT NULL DEFAULT 3,
                result       BYTEA,
                error        TEXT,
                timeout_ms   BIGINT NOT NULL DEFAULT 300000,
                unique_key   TEXT,
                progress     INTEGER,
                metadata     TEXT,
                cancel_requested INTEGER NOT NULL DEFAULT 0,
                expires_at   BIGINT,
                result_ttl_ms BIGINT
            )",
        )
        .execute(&mut conn)?;

        diesel::sql_query(
            "CREATE INDEX IF NOT EXISTS idx_jobs_dequeue
                ON jobs(queue, status, priority DESC, scheduled_at)",
        )
        .execute(&mut conn)?;

        diesel::sql_query("CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)")
            .execute(&mut conn)?;

        // PG partial unique index
        diesel::sql_query(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_unique_key
                ON jobs(unique_key) WHERE unique_key IS NOT NULL AND status IN (0, 1)",
        )
        .execute(&mut conn)?;

        diesel::sql_query(
            "CREATE TABLE IF NOT EXISTS dead_letter (
                id              TEXT PRIMARY KEY,
                original_job_id TEXT NOT NULL,
                queue           TEXT NOT NULL,
                task_name       TEXT NOT NULL,
                payload         BYTEA NOT NULL,
                error           TEXT,
                retry_count     INTEGER NOT NULL,
                failed_at       BIGINT NOT NULL,
                metadata        TEXT,
                priority        INTEGER NOT NULL DEFAULT 0,
                max_retries     INTEGER NOT NULL DEFAULT 3,
                timeout_ms      BIGINT NOT NULL DEFAULT 300000,
                result_ttl_ms   BIGINT
            )",
        )
        .execute(&mut conn)?;

        // Migration: add columns if they don't exist (for existing databases)
        for col in &[
            "ALTER TABLE dead_letter ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE dead_letter ADD COLUMN IF NOT EXISTS max_retries INTEGER NOT NULL DEFAULT 3",
            "ALTER TABLE dead_letter ADD COLUMN IF NOT EXISTS timeout_ms BIGINT NOT NULL DEFAULT 300000",
            "ALTER TABLE dead_letter ADD COLUMN IF NOT EXISTS result_ttl_ms BIGINT",
        ] {
            migration_alter(&mut conn, col);
        }

        diesel::sql_query(
            "CREATE TABLE IF NOT EXISTS rate_limits (
                key         TEXT PRIMARY KEY,
                tokens      DOUBLE PRECISION NOT NULL,
                max_tokens  DOUBLE PRECISION NOT NULL,
                refill_rate DOUBLE PRECISION NOT NULL,
                last_refill BIGINT NOT NULL
            )",
        )
        .execute(&mut conn)?;

        diesel::sql_query(
            "CREATE TABLE IF NOT EXISTS periodic_tasks (
                name        TEXT PRIMARY KEY,
                task_name   TEXT NOT NULL,
                cron_expr   TEXT NOT NULL,
                args        BYTEA,
                kwargs      BYTEA,
                queue       TEXT NOT NULL DEFAULT 'default',
                enabled     BOOLEAN NOT NULL DEFAULT TRUE,
                last_run    BIGINT,
                next_run    BIGINT NOT NULL
            )",
        )
        .execute(&mut conn)?;

        diesel::sql_query(
            "CREATE TABLE IF NOT EXISTS job_errors (
                id        TEXT PRIMARY KEY,
                job_id    TEXT NOT NULL,
                attempt   INTEGER NOT NULL,
                error     TEXT NOT NULL,
                failed_at BIGINT NOT NULL
            )",
        )
        .execute(&mut conn)?;

        diesel::sql_query("CREATE INDEX IF NOT EXISTS idx_job_errors_job_id ON job_errors(job_id)")
            .execute(&mut conn)?;

        diesel::sql_query(
            "CREATE TABLE IF NOT EXISTS job_dependencies (
                id                TEXT PRIMARY KEY,
                job_id            TEXT NOT NULL,
                depends_on_job_id TEXT NOT NULL
            )",
        )
        .execute(&mut conn)?;

        diesel::sql_query(
            "CREATE INDEX IF NOT EXISTS idx_job_deps_job_id ON job_dependencies(job_id)",
        )
        .execute(&mut conn)?;

        diesel::sql_query(
            "CREATE INDEX IF NOT EXISTS idx_job_deps_depends_on ON job_dependencies(depends_on_job_id)"
        ).execute(&mut conn)?;

        diesel::sql_query(
            "CREATE TABLE IF NOT EXISTS task_metrics (
                id           TEXT PRIMARY KEY,
                task_name    TEXT NOT NULL,
                job_id       TEXT NOT NULL,
                wall_time_ns BIGINT NOT NULL,
                memory_bytes BIGINT NOT NULL DEFAULT 0,
                succeeded    BOOLEAN NOT NULL DEFAULT TRUE,
                recorded_at  BIGINT NOT NULL
            )",
        )
        .execute(&mut conn)?;

        diesel::sql_query(
            "CREATE INDEX IF NOT EXISTS idx_task_metrics_task_name ON task_metrics(task_name)",
        )
        .execute(&mut conn)?;

        diesel::sql_query(
            "CREATE INDEX IF NOT EXISTS idx_task_metrics_recorded_at ON task_metrics(recorded_at)",
        )
        .execute(&mut conn)?;

        diesel::sql_query(
            "CREATE TABLE IF NOT EXISTS replay_history (
                id               TEXT PRIMARY KEY,
                original_job_id  TEXT NOT NULL,
                replay_job_id    TEXT NOT NULL,
                replayed_at      BIGINT NOT NULL,
                original_result  BYTEA,
                replay_result    BYTEA,
                original_error   TEXT,
                replay_error     TEXT
            )",
        )
        .execute(&mut conn)?;

        diesel::sql_query(
            "CREATE INDEX IF NOT EXISTS idx_replay_original ON replay_history(original_job_id)",
        )
        .execute(&mut conn)?;

        diesel::sql_query(
            "CREATE TABLE IF NOT EXISTS task_logs (
                id         TEXT PRIMARY KEY,
                job_id     TEXT NOT NULL,
                task_name  TEXT NOT NULL,
                level      TEXT NOT NULL DEFAULT 'info',
                message    TEXT NOT NULL,
                extra      TEXT,
                logged_at  BIGINT NOT NULL
            )",
        )
        .execute(&mut conn)?;

        diesel::sql_query("CREATE INDEX IF NOT EXISTS idx_task_logs_job_id ON task_logs(job_id)")
            .execute(&mut conn)?;

        diesel::sql_query(
            "CREATE INDEX IF NOT EXISTS idx_task_logs_recorded ON task_logs(logged_at)",
        )
        .execute(&mut conn)?;

        diesel::sql_query(
            "CREATE TABLE IF NOT EXISTS circuit_breakers (
                task_name      TEXT PRIMARY KEY,
                state          INTEGER NOT NULL DEFAULT 0,
                failure_count  INTEGER NOT NULL DEFAULT 0,
                last_failure_at BIGINT,
                opened_at      BIGINT,
                half_open_at   BIGINT,
                threshold      INTEGER NOT NULL DEFAULT 5,
                window_ms      BIGINT NOT NULL DEFAULT 60000,
                cooldown_ms    BIGINT NOT NULL DEFAULT 300000,
                half_open_max_probes   INTEGER NOT NULL DEFAULT 5,
                half_open_success_rate DOUBLE PRECISION NOT NULL DEFAULT 0.8,
                half_open_probe_count  INTEGER NOT NULL DEFAULT 0,
                half_open_success_count INTEGER NOT NULL DEFAULT 0,
                half_open_failure_count INTEGER NOT NULL DEFAULT 0
            )",
        )
        .execute(&mut conn)?;

        diesel::sql_query(
            "CREATE TABLE IF NOT EXISTS workers (
                worker_id      TEXT PRIMARY KEY,
                last_heartbeat BIGINT NOT NULL,
                queues         TEXT NOT NULL DEFAULT 'default',
                status         TEXT NOT NULL DEFAULT 'active'
            )",
        )
        .execute(&mut conn)?;

        // Migration: add tags column to workers
        migration_alter(
            &mut conn,
            "ALTER TABLE workers ADD COLUMN IF NOT EXISTS tags TEXT",
        );

        // Migration: add resource advertisement columns to workers
        migration_alter(
            &mut conn,
            "ALTER TABLE workers ADD COLUMN IF NOT EXISTS resources TEXT",
        );
        migration_alter(
            &mut conn,
            "ALTER TABLE workers ADD COLUMN IF NOT EXISTS resource_health TEXT",
        );
        migration_alter(
            &mut conn,
            "ALTER TABLE workers ADD COLUMN IF NOT EXISTS threads INTEGER NOT NULL DEFAULT 0",
        );

        diesel::sql_query(
            "CREATE TABLE IF NOT EXISTS queue_state (
                queue_name TEXT PRIMARY KEY,
                paused     BOOLEAN NOT NULL DEFAULT FALSE,
                paused_at  BIGINT
            )",
        )
        .execute(&mut conn)?;

        diesel::sql_query(
            "CREATE TABLE IF NOT EXISTS archived_jobs (
                id           TEXT PRIMARY KEY,
                queue        TEXT NOT NULL DEFAULT 'default',
                task_name    TEXT NOT NULL,
                payload      BYTEA NOT NULL,
                status       INTEGER NOT NULL DEFAULT 0,
                priority     INTEGER NOT NULL DEFAULT 0,
                created_at   BIGINT NOT NULL,
                scheduled_at BIGINT NOT NULL,
                started_at   BIGINT,
                completed_at BIGINT,
                retry_count  INTEGER NOT NULL DEFAULT 0,
                max_retries  INTEGER NOT NULL DEFAULT 3,
                result       BYTEA,
                error        TEXT,
                timeout_ms   BIGINT NOT NULL DEFAULT 300000,
                unique_key   TEXT,
                progress     INTEGER,
                metadata     TEXT,
                cancel_requested INTEGER NOT NULL DEFAULT 0,
                expires_at   BIGINT,
                result_ttl_ms BIGINT
            )",
        )
        .execute(&mut conn)?;

        diesel::sql_query(
            "CREATE INDEX IF NOT EXISTS idx_archived_jobs_completed ON archived_jobs(completed_at)",
        )
        .execute(&mut conn)?;

        // Periodic tasks timezone migration
        migration_alter(
            &mut conn,
            "ALTER TABLE periodic_tasks ADD COLUMN IF NOT EXISTS timezone TEXT",
        );

        // Migration: add namespace column to jobs
        migration_alter(
            &mut conn,
            "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS namespace TEXT",
        );

        // Migration: add sample-based half-open probes to circuit breakers
        migration_alter(
            &mut conn,
            "ALTER TABLE circuit_breakers ADD COLUMN IF NOT EXISTS half_open_max_probes INTEGER NOT NULL DEFAULT 5",
        );
        migration_alter(
            &mut conn,
            "ALTER TABLE circuit_breakers ADD COLUMN IF NOT EXISTS half_open_success_rate DOUBLE PRECISION NOT NULL DEFAULT 0.8",
        );
        migration_alter(
            &mut conn,
            "ALTER TABLE circuit_breakers ADD COLUMN IF NOT EXISTS half_open_probe_count INTEGER NOT NULL DEFAULT 0",
        );
        migration_alter(
            &mut conn,
            "ALTER TABLE circuit_breakers ADD COLUMN IF NOT EXISTS half_open_success_count INTEGER NOT NULL DEFAULT 0",
        );
        migration_alter(
            &mut conn,
            "ALTER TABLE circuit_breakers ADD COLUMN IF NOT EXISTS half_open_failure_count INTEGER NOT NULL DEFAULT 0",
        );

        // Migration: add namespace column to dead_letter and archived_jobs
        migration_alter(
            &mut conn,
            "ALTER TABLE dead_letter ADD COLUMN IF NOT EXISTS namespace TEXT",
        );
        migration_alter(
            &mut conn,
            "ALTER TABLE archived_jobs ADD COLUMN IF NOT EXISTS namespace TEXT",
        );

        // ── Distributed Locks ─────────────────────────────
        diesel::sql_query(
            "CREATE TABLE IF NOT EXISTS distributed_locks (
                lock_name   TEXT PRIMARY KEY,
                owner_id    TEXT NOT NULL,
                acquired_at BIGINT NOT NULL,
                expires_at  BIGINT NOT NULL
            )",
        )
        .execute(&mut conn)?;

        diesel::sql_query(
            "CREATE INDEX IF NOT EXISTS idx_distributed_locks_expires ON distributed_locks(expires_at)",
        )
        .execute(&mut conn)?;

        // ── Execution Claims ──────────────────────────────
        diesel::sql_query(
            "CREATE TABLE IF NOT EXISTS execution_claims (
                job_id     TEXT PRIMARY KEY,
                worker_id  TEXT NOT NULL,
                claimed_at BIGINT NOT NULL
            )",
        )
        .execute(&mut conn)?;

        diesel::sql_query(
            "CREATE INDEX IF NOT EXISTS idx_execution_claims_claimed ON execution_claims(claimed_at)",
        )
        .execute(&mut conn)?;

        Ok(())
    }
}
