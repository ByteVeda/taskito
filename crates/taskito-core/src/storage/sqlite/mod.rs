mod archival;
mod circuit_breakers;
mod dashboard_settings;
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

use crate::error::{QueueError, Result};
use crate::storage::diesel_common::migrations as common_migrations;

/// Run an ALTER TABLE migration. SQLite has no `ADD COLUMN IF NOT EXISTS`, so a
/// "duplicate column" error means the column already exists and is ignored;
/// every other failure (locked DB, disk full, bad type) is propagated — a
/// silently-skipped ALTER would leave the schema missing a column and surface
/// later as a confusing query error far from the cause.
fn migration_alter(conn: &mut SqliteConnection, sql: &str) -> Result<()> {
    match diesel::sql_query(sql).execute(conn) {
        Ok(_) => Ok(()),
        Err(e) if e.to_string().contains("duplicate column") => Ok(()),
        Err(e) => Err(QueueError::Storage(e)),
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
    /// In-process wake handle, set by the scheduler when push-dispatch is
    /// enabled. Enqueue of a ready job calls `notify_one()` so the scheduler
    /// dispatches immediately instead of waiting for the next poll.
    #[cfg(feature = "push-dispatch")]
    notify: std::sync::Arc<tokio::sync::Notify>,
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

        let storage = Self {
            pool,
            #[cfg(feature = "push-dispatch")]
            notify: std::sync::Arc::new(tokio::sync::Notify::new()),
        };
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

        let storage = Self {
            pool,
            #[cfg(feature = "push-dispatch")]
            notify: std::sync::Arc::new(tokio::sync::Notify::new()),
        };
        storage.run_migrations()?;
        Ok(storage)
    }

    /// Replace the in-process wake handle so it is shared with the scheduler's
    /// [`WakeSource`]. Only meaningful under `push-dispatch`.
    #[cfg(feature = "push-dispatch")]
    pub fn set_notify_handle(&mut self, notify: std::sync::Arc<tokio::sync::Notify>) {
        self.notify = notify;
    }

    /// The in-process wake handle. Enqueue paths call `notify_one()` on this
    /// when a ready job is inserted.
    #[cfg(feature = "push-dispatch")]
    pub fn notify_handle(&self) -> &std::sync::Arc<tokio::sync::Notify> {
        &self.notify
    }

    pub fn conn(
        &self,
    ) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>> {
        Ok(self.pool.get()?)
    }

    fn run_migrations(&self) -> Result<()> {
        let mut conn = self.conn()?;

        for sql in common_migrations::create_tables(&common_migrations::SQLITE) {
            diesel::sql_query(&sql).execute(&mut conn)?;
        }
        // Alters run before indexes: some indexed columns (e.g. `namespace`) are
        // added here, so the index DDL must see the fully-widened tables.
        for sql in common_migrations::alter_statements(&common_migrations::SQLITE) {
            migration_alter(&mut conn, &sql)?;
        }
        for sql in common_migrations::create_indexes() {
            diesel::sql_query(*sql).execute(&mut conn)?;
        }
        // Data backfills must fail loudly — a swallowed failure would leave
        // has_deps wrong and let dequeue bypass dependency enforcement.
        for sql in common_migrations::backfill_statements() {
            diesel::sql_query(*sql).execute(&mut conn)?;
        }
        // Drop legacy tables (e.g. the old `job_payloads` side table). `IF EXISTS`
        // keeps it idempotent, so run it directly rather than via `migration_alter`.
        for sql in common_migrations::drop_legacy_tables() {
            diesel::sql_query(*sql).execute(&mut conn)?;
        }
        drop(conn);

        // Drain any pre-existing terminal jobs left in `jobs` by older
        // versions into `archived_jobs`. Terminal jobs now live there from the
        // moment they transition; this one-time sweep migrates the backlog.
        self.archive_old_jobs(i64::MAX)?;

        Ok(())
    }
}

#[cfg(feature = "push-dispatch")]
impl crate::storage::notify::StorageNotifier for SqliteStorage {
    fn notify_job_ready(&self, _queue: &str, _scheduled_at: i64) {
        // Single-process: wake the in-memory scheduler loop directly.
        self.notify.notify_one();
    }
}

pub use crate::storage::{DeadJob, QueueStats};

#[cfg(test)]
mod tests;
