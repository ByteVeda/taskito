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

use diesel::pg::PgConnection;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};

use crate::error::Result;
use crate::storage::diesel_common::migrations as common_migrations;

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

    pub fn conn(&self) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<PgConnection>>> {
        let mut conn = self.pool.get()?;
        diesel::sql_query(format!("SET search_path TO {}", self.schema))
            .execute(&mut conn)
            .map_err(crate::error::QueueError::Storage)?;
        Ok(conn)
    }

    fn run_migrations(&self) -> Result<()> {
        let mut conn = self.conn()?;

        // Postgres-only: ensure the target schema exists before any DDL runs.
        diesel::sql_query(format!("CREATE SCHEMA IF NOT EXISTS {}", self.schema))
            .execute(&mut conn)?;

        for sql in common_migrations::create_tables(&common_migrations::POSTGRES) {
            diesel::sql_query(&sql).execute(&mut conn)?;
        }
        for sql in common_migrations::create_indexes() {
            diesel::sql_query(*sql).execute(&mut conn)?;
        }
        for sql in common_migrations::alter_statements(&common_migrations::POSTGRES) {
            migration_alter(&mut conn, &sql);
        }

        Ok(())
    }
}
