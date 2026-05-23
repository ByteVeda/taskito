//! PostgreSQL implementation of `WorkflowStorage`.
//!
//! Construction runs the workflow-table migrations once and caches a pool
//! handle to the underlying `PostgresStorage`. Every trait method is generated
//! by the `impl_workflow_diesel_ops!` macro in `diesel_common.rs` — the SQL
//! bodies are byte-identical to SQLite (Diesel rewrites `?` to `$N` per
//! backend), only the DDL differs (`BYTEA` for `BLOB`, `BIGINT` for `INTEGER`
//! timestamps).

use diesel::pg::PgConnection;
use diesel::prelude::*;

use taskito_core::error::Result;
use taskito_core::storage::postgres::PostgresStorage;

use crate::diesel_common::impl_workflow_diesel_ops;

fn run_workflow_migrations(conn: &mut PgConnection) -> Result<()> {
    diesel::sql_query(
        "CREATE TABLE IF NOT EXISTS workflow_definitions (
            id             TEXT PRIMARY KEY,
            name           TEXT NOT NULL,
            version        INTEGER NOT NULL DEFAULT 1,
            dag_data       BYTEA NOT NULL,
            step_metadata  TEXT NOT NULL,
            created_at     BIGINT NOT NULL,
            UNIQUE(name, version)
        )",
    )
    .execute(conn)?;

    diesel::sql_query("CREATE INDEX IF NOT EXISTS idx_wf_def_name ON workflow_definitions(name)")
        .execute(conn)?;

    diesel::sql_query(
        "CREATE TABLE IF NOT EXISTS workflow_runs (
            id               TEXT PRIMARY KEY,
            definition_id    TEXT NOT NULL,
            params           TEXT,
            state            TEXT NOT NULL DEFAULT 'pending',
            started_at       BIGINT,
            completed_at     BIGINT,
            error            TEXT,
            parent_run_id    TEXT,
            parent_node_name TEXT,
            created_at       BIGINT NOT NULL
        )",
    )
    .execute(conn)?;

    diesel::sql_query("CREATE INDEX IF NOT EXISTS idx_wf_run_def ON workflow_runs(definition_id)")
        .execute(conn)?;

    diesel::sql_query("CREATE INDEX IF NOT EXISTS idx_wf_run_state ON workflow_runs(state)")
        .execute(conn)?;

    diesel::sql_query(
        "CREATE TABLE IF NOT EXISTS workflow_nodes (
            id             TEXT PRIMARY KEY,
            run_id         TEXT NOT NULL,
            node_name      TEXT NOT NULL,
            job_id         TEXT,
            status         TEXT NOT NULL DEFAULT 'pending',
            result_hash    TEXT,
            fan_out_count  INTEGER,
            fan_in_data    TEXT,
            started_at     BIGINT,
            completed_at   BIGINT,
            error          TEXT,
            UNIQUE(run_id, node_name)
        )",
    )
    .execute(conn)?;

    diesel::sql_query("CREATE INDEX IF NOT EXISTS idx_wf_node_run ON workflow_nodes(run_id)")
        .execute(conn)?;

    diesel::sql_query(
        "CREATE INDEX IF NOT EXISTS idx_wf_node_status ON workflow_nodes(run_id, status)",
    )
    .execute(conn)?;

    // Saga columns — added in 0.13. Postgres supports `ADD COLUMN IF NOT
    // EXISTS`, so this is naturally idempotent.
    for stmt in [
        "ALTER TABLE workflow_nodes ADD COLUMN IF NOT EXISTS compensation_job_id TEXT",
        "ALTER TABLE workflow_nodes ADD COLUMN IF NOT EXISTS compensation_started_at BIGINT",
        "ALTER TABLE workflow_nodes ADD COLUMN IF NOT EXISTS compensation_completed_at BIGINT",
        "ALTER TABLE workflow_nodes ADD COLUMN IF NOT EXISTS compensation_error TEXT",
    ] {
        diesel::sql_query(stmt).execute(conn)?;
    }

    Ok(())
}

/// Workflow-aware wrapper around `PostgresStorage`.
///
/// Runs workflow table migrations on construction, then delegates all
/// `WorkflowStorage` operations through the shared diesel macro. The wrapped
/// `PostgresStorage` owns the pool; clones share it.
#[derive(Clone)]
pub struct WorkflowPostgresStorage {
    pub(crate) inner: PostgresStorage,
}

impl WorkflowPostgresStorage {
    /// Wrap an existing `PostgresStorage` and ensure workflow tables exist.
    pub fn new(storage: PostgresStorage) -> Result<Self> {
        let mut conn = storage.conn()?;
        run_workflow_migrations(&mut conn)?;
        Ok(Self { inner: storage })
    }

    /// Access the underlying `PostgresStorage`.
    pub fn inner(&self) -> &PostgresStorage {
        &self.inner
    }
}

impl_workflow_diesel_ops!(
    WorkflowPostgresStorage,
    PgConnection,
    crate::diesel_common::pg_rewrite
);
