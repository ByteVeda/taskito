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

use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, CustomizeConnection, Pool};
use diesel::sqlite::SqliteConnection;

use crate::error::Result;

/// Run an ALTER TABLE migration, suppressing "duplicate column" errors (SQLite).
fn migration_alter(conn: &mut SqliteConnection, sql: &str) {
    match diesel::sql_query(sql).execute(conn) {
        Ok(_) => {}
        Err(e) => {
            let msg = e.to_string();
            if !msg.contains("duplicate column") {
                log::warn!("migration failed for '{sql}': {e}");
            }
        }
    }
}

type DbPool = Pool<ConnectionManager<SqliteConnection>>;

/// Sets SQLite pragmas on every new connection from the pool.
#[derive(Debug)]
struct SqlitePragmaCustomizer;

impl CustomizeConnection<SqliteConnection, diesel::r2d2::Error> for SqlitePragmaCustomizer {
    fn on_acquire(
        &self,
        conn: &mut SqliteConnection,
    ) -> std::result::Result<(), diesel::r2d2::Error> {
        diesel::sql_query("PRAGMA journal_mode = WAL")
            .execute(conn)
            .map_err(diesel::r2d2::Error::QueryError)?;
        diesel::sql_query("PRAGMA busy_timeout = 5000")
            .execute(conn)
            .map_err(diesel::r2d2::Error::QueryError)?;
        diesel::sql_query("PRAGMA journal_size_limit = 67108864")
            .execute(conn)
            .map_err(diesel::r2d2::Error::QueryError)?;
        diesel::sql_query("PRAGMA synchronous = NORMAL")
            .execute(conn)
            .map_err(diesel::r2d2::Error::QueryError)?;
        Ok(())
    }
}

/// SQLite-backed storage for the task queue, using Diesel ORM.
#[derive(Clone)]
pub struct SqliteStorage {
    pool: DbPool,
}

impl SqliteStorage {
    /// Open (or create) a SQLite database at the given path.
    pub fn new(db_path: &str) -> Result<Self> {
        Self::with_pool_size(db_path, 8)
    }

    /// Open (or create) a SQLite database with a custom connection pool size.
    pub fn with_pool_size(db_path: &str, pool_size: u32) -> Result<Self> {
        let manager = ConnectionManager::<SqliteConnection>::new(db_path);
        let pool = Pool::builder()
            .max_size(pool_size)
            .connection_customizer(Box::new(SqlitePragmaCustomizer))
            .build(manager)?;

        let storage = Self { pool };
        storage.run_migrations()?;
        Ok(storage)
    }

    /// Create an in-memory storage (useful for tests).
    pub fn in_memory() -> Result<Self> {
        let manager = ConnectionManager::<SqliteConnection>::new(":memory:");
        let pool = Pool::builder()
            .max_size(1)
            .connection_customizer(Box::new(SqlitePragmaCustomizer))
            .build(manager)?;

        let storage = Self { pool };
        storage.run_migrations()?;
        Ok(storage)
    }

    pub(crate) fn conn(
        &self,
    ) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>> {
        Ok(self.pool.get()?)
    }

    fn run_migrations(&self) -> Result<()> {
        let mut conn = self.conn()?;

        diesel::sql_query(
            "CREATE TABLE IF NOT EXISTS jobs (
                id           TEXT PRIMARY KEY,
                queue        TEXT NOT NULL DEFAULT 'default',
                task_name    TEXT NOT NULL,
                payload      BLOB NOT NULL,
                status       INTEGER NOT NULL DEFAULT 0,
                priority     INTEGER NOT NULL DEFAULT 0,
                created_at   INTEGER NOT NULL,
                scheduled_at INTEGER NOT NULL,
                started_at   INTEGER,
                completed_at INTEGER,
                retry_count  INTEGER NOT NULL DEFAULT 0,
                max_retries  INTEGER NOT NULL DEFAULT 3,
                result       BLOB,
                error        TEXT,
                timeout_ms   INTEGER NOT NULL DEFAULT 300000,
                unique_key   TEXT,
                progress     INTEGER,
                metadata     TEXT,
                cancel_requested INTEGER NOT NULL DEFAULT 0,
                expires_at   INTEGER,
                result_ttl_ms INTEGER
            )",
        )
        .execute(&mut conn)?;

        // Add new columns if they don't exist (migration for existing DBs)
        migration_alter(
            &mut conn,
            "ALTER TABLE jobs ADD COLUMN cancel_requested INTEGER NOT NULL DEFAULT 0",
        );
        migration_alter(&mut conn, "ALTER TABLE jobs ADD COLUMN expires_at INTEGER");
        migration_alter(
            &mut conn,
            "ALTER TABLE jobs ADD COLUMN result_ttl_ms INTEGER",
        );

        diesel::sql_query(
            "CREATE INDEX IF NOT EXISTS idx_jobs_dequeue
                ON jobs(queue, status, priority DESC, scheduled_at)",
        )
        .execute(&mut conn)?;

        diesel::sql_query("CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)")
            .execute(&mut conn)?;

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
                payload         BLOB NOT NULL,
                error           TEXT,
                retry_count     INTEGER NOT NULL,
                failed_at       INTEGER NOT NULL,
                metadata        TEXT,
                priority        INTEGER NOT NULL DEFAULT 0,
                max_retries     INTEGER NOT NULL DEFAULT 3,
                timeout_ms      INTEGER NOT NULL DEFAULT 300000,
                result_ttl_ms   INTEGER
            )",
        )
        .execute(&mut conn)?;

        // Migration: add columns if they don't exist (for existing databases)
        for col in &[
            "ALTER TABLE dead_letter ADD COLUMN priority INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE dead_letter ADD COLUMN max_retries INTEGER NOT NULL DEFAULT 3",
            "ALTER TABLE dead_letter ADD COLUMN timeout_ms INTEGER NOT NULL DEFAULT 300000",
            "ALTER TABLE dead_letter ADD COLUMN result_ttl_ms INTEGER",
        ] {
            migration_alter(&mut conn, col);
        }

        diesel::sql_query(
            "CREATE TABLE IF NOT EXISTS rate_limits (
                key         TEXT PRIMARY KEY,
                tokens      REAL NOT NULL,
                max_tokens  REAL NOT NULL,
                refill_rate REAL NOT NULL,
                last_refill INTEGER NOT NULL
            )",
        )
        .execute(&mut conn)?;

        diesel::sql_query(
            "CREATE TABLE IF NOT EXISTS periodic_tasks (
                name        TEXT PRIMARY KEY,
                task_name   TEXT NOT NULL,
                cron_expr   TEXT NOT NULL,
                args        BLOB,
                kwargs      BLOB,
                queue       TEXT NOT NULL DEFAULT 'default',
                enabled     INTEGER NOT NULL DEFAULT 1,
                last_run    INTEGER,
                next_run    INTEGER NOT NULL
            )",
        )
        .execute(&mut conn)?;

        diesel::sql_query(
            "CREATE TABLE IF NOT EXISTS job_errors (
                id        TEXT PRIMARY KEY,
                job_id    TEXT NOT NULL,
                attempt   INTEGER NOT NULL,
                error     TEXT NOT NULL,
                failed_at INTEGER NOT NULL
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

        // ── Task Metrics ──────────────────────────────────
        diesel::sql_query(
            "CREATE TABLE IF NOT EXISTS task_metrics (
                id           TEXT PRIMARY KEY,
                task_name    TEXT NOT NULL,
                job_id       TEXT NOT NULL,
                wall_time_ns INTEGER NOT NULL,
                memory_bytes INTEGER NOT NULL DEFAULT 0,
                succeeded    INTEGER NOT NULL DEFAULT 1,
                recorded_at  INTEGER NOT NULL
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

        // ── Replay History ────────────────────────────────
        diesel::sql_query(
            "CREATE TABLE IF NOT EXISTS replay_history (
                id               TEXT PRIMARY KEY,
                original_job_id  TEXT NOT NULL,
                replay_job_id    TEXT NOT NULL,
                replayed_at      INTEGER NOT NULL,
                original_result  BLOB,
                replay_result    BLOB,
                original_error   TEXT,
                replay_error     TEXT
            )",
        )
        .execute(&mut conn)?;

        diesel::sql_query(
            "CREATE INDEX IF NOT EXISTS idx_replay_original ON replay_history(original_job_id)",
        )
        .execute(&mut conn)?;

        // ── Task Logs ─────────────────────────────────────
        diesel::sql_query(
            "CREATE TABLE IF NOT EXISTS task_logs (
                id         TEXT PRIMARY KEY,
                job_id     TEXT NOT NULL,
                task_name  TEXT NOT NULL,
                level      TEXT NOT NULL DEFAULT 'info',
                message    TEXT NOT NULL,
                extra      TEXT,
                logged_at  INTEGER NOT NULL
            )",
        )
        .execute(&mut conn)?;

        diesel::sql_query("CREATE INDEX IF NOT EXISTS idx_task_logs_job_id ON task_logs(job_id)")
            .execute(&mut conn)?;

        diesel::sql_query(
            "CREATE INDEX IF NOT EXISTS idx_task_logs_recorded ON task_logs(logged_at)",
        )
        .execute(&mut conn)?;

        // ── Circuit Breakers ──────────────────────────────
        diesel::sql_query(
            "CREATE TABLE IF NOT EXISTS circuit_breakers (
                task_name      TEXT PRIMARY KEY,
                state          INTEGER NOT NULL DEFAULT 0,
                failure_count  INTEGER NOT NULL DEFAULT 0,
                last_failure_at INTEGER,
                opened_at      INTEGER,
                half_open_at   INTEGER,
                threshold      INTEGER NOT NULL DEFAULT 5,
                window_ms      INTEGER NOT NULL DEFAULT 60000,
                cooldown_ms    INTEGER NOT NULL DEFAULT 300000,
                half_open_max_probes   INTEGER NOT NULL DEFAULT 5,
                half_open_success_rate REAL NOT NULL DEFAULT 0.8,
                half_open_probe_count  INTEGER NOT NULL DEFAULT 0,
                half_open_success_count INTEGER NOT NULL DEFAULT 0,
                half_open_failure_count INTEGER NOT NULL DEFAULT 0
            )",
        )
        .execute(&mut conn)?;

        // ── Workers ───────────────────────────────────────
        diesel::sql_query(
            "CREATE TABLE IF NOT EXISTS workers (
                worker_id      TEXT PRIMARY KEY,
                last_heartbeat INTEGER NOT NULL,
                queues         TEXT NOT NULL DEFAULT 'default',
                status         TEXT NOT NULL DEFAULT 'active'
            )",
        )
        .execute(&mut conn)?;

        // Migration: add tags column to workers
        migration_alter(&mut conn, "ALTER TABLE workers ADD COLUMN tags TEXT");

        // Migration: add resource advertisement columns to workers
        migration_alter(&mut conn, "ALTER TABLE workers ADD COLUMN resources TEXT");
        migration_alter(
            &mut conn,
            "ALTER TABLE workers ADD COLUMN resource_health TEXT",
        );
        migration_alter(
            &mut conn,
            "ALTER TABLE workers ADD COLUMN threads INTEGER NOT NULL DEFAULT 0",
        );

        // Migration: add worker discovery metadata columns
        migration_alter(
            &mut conn,
            "ALTER TABLE workers ADD COLUMN started_at INTEGER",
        );
        migration_alter(&mut conn, "ALTER TABLE workers ADD COLUMN hostname TEXT");
        migration_alter(&mut conn, "ALTER TABLE workers ADD COLUMN pid INTEGER");
        migration_alter(&mut conn, "ALTER TABLE workers ADD COLUMN pool_type TEXT");

        // ── Queue State ──────────────────────────────────
        diesel::sql_query(
            "CREATE TABLE IF NOT EXISTS queue_state (
                queue_name TEXT PRIMARY KEY,
                paused     INTEGER NOT NULL DEFAULT 0,
                paused_at  INTEGER
            )",
        )
        .execute(&mut conn)?;

        // ── Archived Jobs ────────────────────────────────
        diesel::sql_query(
            "CREATE TABLE IF NOT EXISTS archived_jobs (
                id           TEXT PRIMARY KEY,
                queue        TEXT NOT NULL DEFAULT 'default',
                task_name    TEXT NOT NULL,
                payload      BLOB NOT NULL,
                status       INTEGER NOT NULL DEFAULT 0,
                priority     INTEGER NOT NULL DEFAULT 0,
                created_at   INTEGER NOT NULL,
                scheduled_at INTEGER NOT NULL,
                started_at   INTEGER,
                completed_at INTEGER,
                retry_count  INTEGER NOT NULL DEFAULT 0,
                max_retries  INTEGER NOT NULL DEFAULT 3,
                result       BLOB,
                error        TEXT,
                timeout_ms   INTEGER NOT NULL DEFAULT 300000,
                unique_key   TEXT,
                progress     INTEGER,
                metadata     TEXT,
                cancel_requested INTEGER NOT NULL DEFAULT 0,
                expires_at   INTEGER,
                result_ttl_ms INTEGER
            )",
        )
        .execute(&mut conn)?;

        diesel::sql_query(
            "CREATE INDEX IF NOT EXISTS idx_archived_jobs_completed ON archived_jobs(completed_at)",
        )
        .execute(&mut conn)?;

        // ── Periodic tasks timezone migration ────────────
        migration_alter(
            &mut conn,
            "ALTER TABLE periodic_tasks ADD COLUMN timezone TEXT",
        );

        // Migration: add namespace column to jobs
        migration_alter(&mut conn, "ALTER TABLE jobs ADD COLUMN namespace TEXT");

        // Migration: add sample-based half-open probes to circuit breakers
        migration_alter(
            &mut conn,
            "ALTER TABLE circuit_breakers ADD COLUMN half_open_max_probes INTEGER NOT NULL DEFAULT 5",
        );
        migration_alter(
            &mut conn,
            "ALTER TABLE circuit_breakers ADD COLUMN half_open_success_rate REAL NOT NULL DEFAULT 0.8",
        );
        migration_alter(
            &mut conn,
            "ALTER TABLE circuit_breakers ADD COLUMN half_open_probe_count INTEGER NOT NULL DEFAULT 0",
        );
        migration_alter(
            &mut conn,
            "ALTER TABLE circuit_breakers ADD COLUMN half_open_success_count INTEGER NOT NULL DEFAULT 0",
        );
        migration_alter(
            &mut conn,
            "ALTER TABLE circuit_breakers ADD COLUMN half_open_failure_count INTEGER NOT NULL DEFAULT 0",
        );

        // Migration: add namespace column to dead_letter and archived_jobs
        migration_alter(
            &mut conn,
            "ALTER TABLE dead_letter ADD COLUMN namespace TEXT",
        );
        migration_alter(
            &mut conn,
            "ALTER TABLE archived_jobs ADD COLUMN namespace TEXT",
        );

        // ── Distributed Locks ─────────────────────────────
        diesel::sql_query(
            "CREATE TABLE IF NOT EXISTS distributed_locks (
                lock_name   TEXT PRIMARY KEY,
                owner_id    TEXT NOT NULL,
                acquired_at INTEGER NOT NULL,
                expires_at  INTEGER NOT NULL
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
                claimed_at INTEGER NOT NULL
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

pub use crate::storage::{DeadJob, QueueStats};

#[cfg(test)]
mod tests;
