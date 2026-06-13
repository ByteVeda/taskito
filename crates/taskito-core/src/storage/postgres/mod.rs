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

#[cfg(feature = "push-dispatch")]
pub mod listener;

use diesel::pg::PgConnection;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};

use crate::error::Result;
use crate::storage::diesel_common::migrations as common_migrations;

/// Run an ALTER TABLE migration. Postgres statements use `ADD COLUMN IF NOT
/// EXISTS`, so the already-applied case succeeds silently and any error is a
/// genuine failure (locked table, permissions, disk) that must be propagated
/// rather than leaving the schema missing a column.
fn migration_alter(conn: &mut PgConnection, sql: &str) -> Result<()> {
    diesel::sql_query(sql).execute(conn)?;
    Ok(())
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

/// Quote a SQL identifier for safe interpolation. Postgres can't bind
/// identifiers as parameters, and while `validate_schema_name` already
/// restricts the schema to `[A-Za-z0-9_]`, quoting here makes the structural
/// safety explicit rather than relying solely on the validator.
fn pg_quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

/// PostgreSQL-backed storage for the task queue, using Diesel ORM.
#[derive(Clone)]
pub struct PostgresStorage {
    pool: PgPool,
    schema: String,
    /// Original connection URL, retained only to open the dedicated
    /// (non-pooled) `LISTEN` connection used by push-dispatch.
    #[cfg(feature = "push-dispatch")]
    database_url: String,
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
            #[cfg(feature = "push-dispatch")]
            database_url: database_url.to_string(),
        };
        storage.run_migrations()?;
        Ok(storage)
    }

    /// The connection URL, for opening the dedicated `LISTEN` connection.
    #[cfg(feature = "push-dispatch")]
    pub fn database_url(&self) -> &str {
        &self.database_url
    }

    pub fn conn(&self) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<PgConnection>>> {
        let mut conn = self.pool.get()?;
        diesel::sql_query(format!(
            "SET search_path TO {}",
            pg_quote_ident(&self.schema)
        ))
        .execute(&mut conn)
        .map_err(crate::error::QueueError::Storage)?;
        Ok(conn)
    }

    fn run_migrations(&self) -> Result<()> {
        let mut conn = self.conn()?;

        // Postgres-only: ensure the target schema exists before any DDL runs.
        diesel::sql_query(format!(
            "CREATE SCHEMA IF NOT EXISTS {}",
            pg_quote_ident(&self.schema)
        ))
        .execute(&mut conn)?;

        for sql in common_migrations::create_tables(&common_migrations::POSTGRES) {
            diesel::sql_query(&sql).execute(&mut conn)?;
        }
        for sql in common_migrations::create_indexes() {
            diesel::sql_query(*sql).execute(&mut conn)?;
        }
        for sql in common_migrations::alter_statements(&common_migrations::POSTGRES) {
            migration_alter(&mut conn, &sql)?;
        }
        // Data backfills must fail loudly — a swallowed failure would leave
        // has_deps wrong and let dequeue bypass dependency enforcement.
        for sql in common_migrations::backfill_statements() {
            diesel::sql_query(*sql).execute(&mut conn)?;
        }
        for sql in common_migrations::backfill_payload_side_table(&common_migrations::POSTGRES) {
            diesel::sql_query(&sql).execute(&mut conn)?;
        }
        drop(conn);

        // Drain any pre-existing terminal jobs left in `jobs` by older
        // versions into `archived_jobs`. Terminal jobs now live there from the
        // moment they transition; this one-time sweep migrates the backlog.
        self.archive_old_jobs(i64::MAX)?;

        Ok(())
    }
}

/// Postgres `NOTIFY` channel that carries "a ready job was enqueued" signals.
#[cfg(feature = "push-dispatch")]
pub const JOB_READY_CHANNEL: &str = "taskito_job_ready";

#[cfg(feature = "push-dispatch")]
impl crate::storage::notify::StorageNotifier for PostgresStorage {
    fn notify_job_ready(&self, queue: &str, _scheduled_at: i64) {
        // Best-effort: a failed NOTIFY only costs the latency improvement —
        // the scheduler's fallback poll still picks the job up.
        let mut conn = match self.conn() {
            Ok(c) => c,
            Err(e) => {
                log::warn!("push-dispatch: NOTIFY conn failed: {e}");
                return;
            }
        };
        // Bind the queue as a parameter so the payload can't break out of the
        // NOTIFY statement.
        let stmt = diesel::sql_query(format!("SELECT pg_notify('{JOB_READY_CHANNEL}', $1)"))
            .bind::<diesel::sql_types::Text, _>(queue);
        if let Err(e) = stmt.execute(&mut conn) {
            log::warn!("push-dispatch: pg_notify failed: {e}");
        }
    }
}
