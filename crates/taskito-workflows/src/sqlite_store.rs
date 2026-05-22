//! SQLite implementation of `WorkflowStorage`.
//!
//! Construction runs the workflow-table migrations once and caches a pool
//! handle to the underlying `SqliteStorage`. Every trait method is generated
//! by the `impl_workflow_diesel_ops!` macro in `diesel_common.rs` — both
//! backends share byte-identical SQL.

use diesel::prelude::*;
use diesel::sqlite::SqliteConnection;

use taskito_core::error::Result;
use taskito_core::storage::sqlite::SqliteStorage;

use crate::diesel_common::impl_workflow_diesel_ops;

fn run_workflow_migrations(conn: &mut SqliteConnection) -> Result<()> {
    diesel::sql_query(
        "CREATE TABLE IF NOT EXISTS workflow_definitions (
            id             TEXT PRIMARY KEY,
            name           TEXT NOT NULL,
            version        INTEGER NOT NULL DEFAULT 1,
            dag_data       BLOB NOT NULL,
            step_metadata  TEXT NOT NULL,
            created_at     INTEGER NOT NULL,
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
            started_at       INTEGER,
            completed_at     INTEGER,
            error            TEXT,
            parent_run_id    TEXT,
            parent_node_name TEXT,
            created_at       INTEGER NOT NULL
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
            started_at     INTEGER,
            completed_at   INTEGER,
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

    // Saga columns — added in 0.13 alongside the saga feature. SQLite has no
    // `ADD COLUMN IF NOT EXISTS`, so we swallow `duplicate column` errors to
    // make this idempotent across restarts.
    for stmt in [
        "ALTER TABLE workflow_nodes ADD COLUMN compensation_job_id TEXT",
        "ALTER TABLE workflow_nodes ADD COLUMN compensation_started_at INTEGER",
        "ALTER TABLE workflow_nodes ADD COLUMN compensation_completed_at INTEGER",
        "ALTER TABLE workflow_nodes ADD COLUMN compensation_error TEXT",
    ] {
        if let Err(e) = diesel::sql_query(stmt).execute(conn) {
            let msg = e.to_string();
            if !msg.contains("duplicate column") {
                return Err(e.into());
            }
        }
    }

    Ok(())
}

/// Workflow-aware wrapper around `SqliteStorage`.
///
/// Runs workflow table migrations on construction, then delegates all
/// `WorkflowStorage` operations through the shared diesel macro.
#[derive(Clone)]
pub struct WorkflowSqliteStorage {
    pub(crate) inner: SqliteStorage,
}

impl WorkflowSqliteStorage {
    /// Wrap an existing `SqliteStorage` and ensure workflow tables exist.
    pub fn new(storage: SqliteStorage) -> Result<Self> {
        let mut conn = storage.conn()?;
        run_workflow_migrations(&mut conn)?;
        Ok(Self { inner: storage })
    }

    /// Access the underlying `SqliteStorage`.
    pub fn inner(&self) -> &SqliteStorage {
        &self.inner
    }
}

impl_workflow_diesel_ops!(
    WorkflowSqliteStorage,
    SqliteConnection,
    crate::diesel_common::sql_as_is
);
