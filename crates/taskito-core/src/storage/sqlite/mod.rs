mod jobs;
mod dead_letter;
mod rate_limits;
mod periodic;
mod metrics;
mod logs;
mod circuit_breakers;
mod trait_impl;
mod workers;

use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};
use diesel::sqlite::SqliteConnection;

use crate::error::Result;

type DbPool = Pool<ConnectionManager<SqliteConnection>>;

/// SQLite-backed storage for the task queue, using Diesel ORM.
#[derive(Clone)]
pub struct SqliteStorage {
    pool: DbPool,
}

impl SqliteStorage {
    /// Open (or create) a SQLite database at the given path.
    pub fn new(db_path: &str) -> Result<Self> {
        let manager = ConnectionManager::<SqliteConnection>::new(db_path);
        let pool = Pool::builder()
            .max_size(8)
            .build(manager)?;

        let storage = Self { pool };
        storage.run_pragmas()?;
        storage.run_migrations()?;
        Ok(storage)
    }

    /// Create an in-memory storage (useful for tests).
    pub fn in_memory() -> Result<Self> {
        let manager = ConnectionManager::<SqliteConnection>::new(":memory:");
        let pool = Pool::builder()
            .max_size(1)
            .build(manager)?;

        let storage = Self { pool };
        storage.run_pragmas()?;
        storage.run_migrations()?;
        Ok(storage)
    }

    pub(crate) fn conn(&self) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>> {
        Ok(self.pool.get()?)
    }

    fn run_pragmas(&self) -> Result<()> {
        let mut conn = self.conn()?;
        diesel::sql_query("PRAGMA journal_mode = WAL").execute(&mut conn)?;
        diesel::sql_query("PRAGMA busy_timeout = 5000").execute(&mut conn)?;
        diesel::sql_query("PRAGMA journal_size_limit = 67108864").execute(&mut conn)?;
        diesel::sql_query("PRAGMA synchronous = NORMAL").execute(&mut conn)?;
        Ok(())
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
            )"
        ).execute(&mut conn)?;

        // Add new columns if they don't exist (migration for existing DBs)
        let _ = diesel::sql_query(
            "ALTER TABLE jobs ADD COLUMN cancel_requested INTEGER NOT NULL DEFAULT 0"
        ).execute(&mut conn);
        let _ = diesel::sql_query(
            "ALTER TABLE jobs ADD COLUMN expires_at INTEGER"
        ).execute(&mut conn);
        let _ = diesel::sql_query(
            "ALTER TABLE jobs ADD COLUMN result_ttl_ms INTEGER"
        ).execute(&mut conn);

        diesel::sql_query(
            "CREATE INDEX IF NOT EXISTS idx_jobs_dequeue
                ON jobs(queue, status, priority DESC, scheduled_at)"
        ).execute(&mut conn)?;

        diesel::sql_query(
            "CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)"
        ).execute(&mut conn)?;

        diesel::sql_query(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_unique_key
                ON jobs(unique_key) WHERE unique_key IS NOT NULL AND status IN (0, 1)"
        ).execute(&mut conn)?;

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
                metadata        TEXT
            )"
        ).execute(&mut conn)?;

        diesel::sql_query(
            "CREATE TABLE IF NOT EXISTS rate_limits (
                key         TEXT PRIMARY KEY,
                tokens      REAL NOT NULL,
                max_tokens  REAL NOT NULL,
                refill_rate REAL NOT NULL,
                last_refill INTEGER NOT NULL
            )"
        ).execute(&mut conn)?;

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
            )"
        ).execute(&mut conn)?;

        diesel::sql_query(
            "CREATE TABLE IF NOT EXISTS job_errors (
                id        TEXT PRIMARY KEY,
                job_id    TEXT NOT NULL,
                attempt   INTEGER NOT NULL,
                error     TEXT NOT NULL,
                failed_at INTEGER NOT NULL
            )"
        ).execute(&mut conn)?;

        diesel::sql_query(
            "CREATE INDEX IF NOT EXISTS idx_job_errors_job_id ON job_errors(job_id)"
        ).execute(&mut conn)?;

        diesel::sql_query(
            "CREATE TABLE IF NOT EXISTS job_dependencies (
                id                TEXT PRIMARY KEY,
                job_id            TEXT NOT NULL,
                depends_on_job_id TEXT NOT NULL
            )"
        ).execute(&mut conn)?;

        diesel::sql_query(
            "CREATE INDEX IF NOT EXISTS idx_job_deps_job_id ON job_dependencies(job_id)"
        ).execute(&mut conn)?;

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
            )"
        ).execute(&mut conn)?;

        diesel::sql_query(
            "CREATE INDEX IF NOT EXISTS idx_task_metrics_task_name ON task_metrics(task_name)"
        ).execute(&mut conn)?;

        diesel::sql_query(
            "CREATE INDEX IF NOT EXISTS idx_task_metrics_recorded_at ON task_metrics(recorded_at)"
        ).execute(&mut conn)?;

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
            )"
        ).execute(&mut conn)?;

        diesel::sql_query(
            "CREATE INDEX IF NOT EXISTS idx_replay_original ON replay_history(original_job_id)"
        ).execute(&mut conn)?;

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
            )"
        ).execute(&mut conn)?;

        diesel::sql_query(
            "CREATE INDEX IF NOT EXISTS idx_task_logs_job_id ON task_logs(job_id)"
        ).execute(&mut conn)?;

        diesel::sql_query(
            "CREATE INDEX IF NOT EXISTS idx_task_logs_recorded ON task_logs(logged_at)"
        ).execute(&mut conn)?;

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
                cooldown_ms    INTEGER NOT NULL DEFAULT 300000
            )"
        ).execute(&mut conn)?;

        // ── Workers ───────────────────────────────────────
        diesel::sql_query(
            "CREATE TABLE IF NOT EXISTS workers (
                worker_id      TEXT PRIMARY KEY,
                last_heartbeat INTEGER NOT NULL,
                queues         TEXT NOT NULL DEFAULT 'default',
                status         TEXT NOT NULL DEFAULT 'active'
            )"
        ).execute(&mut conn)?;

        Ok(())
    }
}

// ── Helper types ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Default)]
pub struct QueueStats {
    pub pending: i64,
    pub running: i64,
    pub completed: i64,
    pub failed: i64,
    pub dead: i64,
    pub cancelled: i64,
}

#[derive(Debug, Clone)]
pub struct DeadJob {
    pub id: String,
    pub original_job_id: String,
    pub queue: String,
    pub task_name: String,
    pub payload: Vec<u8>,
    pub error: Option<String>,
    pub retry_count: i32,
    pub failed_at: i64,
    pub metadata: Option<String>,
}

impl From<super::models::DeadLetterRow> for DeadJob {
    fn from(row: super::models::DeadLetterRow) -> Self {
        Self {
            id: row.id,
            original_job_id: row.original_job_id,
            queue: row.queue,
            task_name: row.task_name,
            payload: row.payload,
            error: row.error,
            retry_count: row.retry_count,
            failed_at: row.failed_at,
            metadata: row.metadata,
        }
    }
}

#[cfg(test)]
mod tests;
