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

use crate::error::Result;
use crate::storage::diesel_common::migrations as common_migrations;

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
        for sql in common_migrations::create_indexes() {
            diesel::sql_query(*sql).execute(&mut conn)?;
        }
        for sql in common_migrations::alter_statements(&common_migrations::SQLITE) {
            migration_alter(&mut conn, &sql);
        }

        Ok(())
    }
}

pub use crate::storage::{DeadJob, QueueStats};

#[cfg(test)]
mod tests;
