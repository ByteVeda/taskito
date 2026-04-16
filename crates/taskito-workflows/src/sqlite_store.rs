use diesel::prelude::*;
use diesel::sql_types::Text;
use diesel::sqlite::SqliteConnection;

use taskito_core::error::Result;
use taskito_core::storage::sqlite::SqliteStorage;

use crate::storage::WorkflowStorage;
use crate::{
    StepMetadata, WorkflowDefinition, WorkflowNode, WorkflowNodeStatus, WorkflowRun, WorkflowState,
};

// ── Row types for sql_query results ──────────────────────────────────

#[derive(QueryableByName)]
struct DefinitionRow {
    #[diesel(sql_type = Text)]
    id: String,
    #[diesel(sql_type = Text)]
    name: String,
    #[diesel(sql_type = diesel::sql_types::Integer)]
    version: i32,
    #[diesel(sql_type = diesel::sql_types::Binary)]
    dag_data: Vec<u8>,
    #[diesel(sql_type = Text)]
    step_metadata: String,
    #[diesel(sql_type = diesel::sql_types::BigInt)]
    created_at: i64,
}

#[derive(QueryableByName)]
struct RunRow {
    #[diesel(sql_type = Text)]
    id: String,
    #[diesel(sql_type = Text)]
    definition_id: String,
    #[diesel(sql_type = diesel::sql_types::Nullable<Text>)]
    params: Option<String>,
    #[diesel(sql_type = Text)]
    state: String,
    #[diesel(sql_type = diesel::sql_types::Nullable<diesel::sql_types::BigInt>)]
    started_at: Option<i64>,
    #[diesel(sql_type = diesel::sql_types::Nullable<diesel::sql_types::BigInt>)]
    completed_at: Option<i64>,
    #[diesel(sql_type = diesel::sql_types::Nullable<Text>)]
    error: Option<String>,
    #[diesel(sql_type = diesel::sql_types::Nullable<Text>)]
    parent_run_id: Option<String>,
    #[diesel(sql_type = diesel::sql_types::Nullable<Text>)]
    parent_node_name: Option<String>,
    #[diesel(sql_type = diesel::sql_types::BigInt)]
    created_at: i64,
}

#[derive(QueryableByName)]
struct NodeRow {
    #[diesel(sql_type = Text)]
    id: String,
    #[diesel(sql_type = Text)]
    run_id: String,
    #[diesel(sql_type = Text)]
    node_name: String,
    #[diesel(sql_type = diesel::sql_types::Nullable<Text>)]
    job_id: Option<String>,
    #[diesel(sql_type = Text)]
    status: String,
    #[diesel(sql_type = diesel::sql_types::Nullable<Text>)]
    result_hash: Option<String>,
    #[diesel(sql_type = diesel::sql_types::Nullable<diesel::sql_types::Integer>)]
    fan_out_count: Option<i32>,
    #[diesel(sql_type = diesel::sql_types::Nullable<Text>)]
    fan_in_data: Option<String>,
    #[diesel(sql_type = diesel::sql_types::Nullable<diesel::sql_types::BigInt>)]
    started_at: Option<i64>,
    #[diesel(sql_type = diesel::sql_types::Nullable<diesel::sql_types::BigInt>)]
    completed_at: Option<i64>,
    #[diesel(sql_type = diesel::sql_types::Nullable<Text>)]
    error: Option<String>,
}

// ── Conversions ──────────────────────────────────────────────────────

fn definition_from_row(row: DefinitionRow) -> Result<WorkflowDefinition> {
    let step_metadata: std::collections::HashMap<String, StepMetadata> =
        serde_json::from_str(&row.step_metadata).map_err(|e| {
            taskito_core::error::QueueError::Serialization(format!(
                "failed to deserialize step_metadata: {e}"
            ))
        })?;
    Ok(WorkflowDefinition {
        id: row.id,
        name: row.name,
        version: row.version,
        dag_data: row.dag_data,
        step_metadata,
        created_at: row.created_at,
    })
}

fn run_from_row(row: RunRow) -> WorkflowRun {
    WorkflowRun {
        id: row.id,
        definition_id: row.definition_id,
        params: row.params,
        state: WorkflowState::from_str_val(&row.state).unwrap_or(WorkflowState::Pending),
        started_at: row.started_at,
        completed_at: row.completed_at,
        error: row.error,
        parent_run_id: row.parent_run_id,
        parent_node_name: row.parent_node_name,
        created_at: row.created_at,
    }
}

fn node_from_row(row: NodeRow) -> WorkflowNode {
    WorkflowNode {
        id: row.id,
        run_id: row.run_id,
        node_name: row.node_name,
        job_id: row.job_id,
        status: WorkflowNodeStatus::from_str_val(&row.status)
            .unwrap_or(WorkflowNodeStatus::Pending),
        result_hash: row.result_hash,
        fan_out_count: row.fan_out_count,
        fan_in_data: row.fan_in_data,
        started_at: row.started_at,
        completed_at: row.completed_at,
        error: row.error,
    }
}

// ── Migrations ───────────────────────────────────────────────────────

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

    Ok(())
}

// ── Wrapper that runs migrations ─────────────────────────────────────

/// Workflow-aware wrapper around `SqliteStorage`.
///
/// Runs workflow table migrations on construction, then delegates
/// all `WorkflowStorage` operations to the underlying connection pool.
#[derive(Clone)]
pub struct WorkflowSqliteStorage {
    inner: SqliteStorage,
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

// ── WorkflowStorage impl ────────────────────────────────────────────

impl WorkflowStorage for WorkflowSqliteStorage {
    fn create_workflow_definition(&self, def: &WorkflowDefinition) -> Result<()> {
        let mut conn = self.inner.conn()?;
        let meta_json = serde_json::to_string(&def.step_metadata).map_err(|e| {
            taskito_core::error::QueueError::Serialization(format!(
                "failed to serialize step_metadata: {e}"
            ))
        })?;

        diesel::sql_query(
            "INSERT INTO workflow_definitions (id, name, version, dag_data, step_metadata, created_at)
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind::<Text, _>(&def.id)
        .bind::<Text, _>(&def.name)
        .bind::<diesel::sql_types::Integer, _>(def.version)
        .bind::<diesel::sql_types::Binary, _>(&def.dag_data)
        .bind::<Text, _>(&meta_json)
        .bind::<diesel::sql_types::BigInt, _>(def.created_at)
        .execute(&mut conn)?;

        Ok(())
    }

    fn get_workflow_definition(
        &self,
        name: &str,
        version: Option<i32>,
    ) -> Result<Option<WorkflowDefinition>> {
        let mut conn = self.inner.conn()?;

        let rows: Vec<DefinitionRow> = if let Some(v) = version {
            diesel::sql_query(
                "SELECT id, name, version, dag_data, step_metadata, created_at
                 FROM workflow_definitions WHERE name = ? AND version = ?",
            )
            .bind::<Text, _>(name)
            .bind::<diesel::sql_types::Integer, _>(v)
            .load(&mut conn)?
        } else {
            diesel::sql_query(
                "SELECT id, name, version, dag_data, step_metadata, created_at
                 FROM workflow_definitions WHERE name = ? ORDER BY version DESC LIMIT 1",
            )
            .bind::<Text, _>(name)
            .load(&mut conn)?
        };

        match rows.into_iter().next() {
            Some(row) => Ok(Some(definition_from_row(row)?)),
            None => Ok(None),
        }
    }

    fn get_workflow_definition_by_id(&self, id: &str) -> Result<Option<WorkflowDefinition>> {
        let mut conn = self.inner.conn()?;
        let rows: Vec<DefinitionRow> = diesel::sql_query(
            "SELECT id, name, version, dag_data, step_metadata, created_at
             FROM workflow_definitions WHERE id = ?",
        )
        .bind::<Text, _>(id)
        .load(&mut conn)?;

        match rows.into_iter().next() {
            Some(row) => Ok(Some(definition_from_row(row)?)),
            None => Ok(None),
        }
    }

    fn create_workflow_run(&self, run: &WorkflowRun) -> Result<()> {
        let mut conn = self.inner.conn()?;
        diesel::sql_query(
            "INSERT INTO workflow_runs
                (id, definition_id, params, state, started_at, completed_at, error,
                 parent_run_id, parent_node_name, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind::<Text, _>(&run.id)
        .bind::<Text, _>(&run.definition_id)
        .bind::<diesel::sql_types::Nullable<Text>, _>(&run.params)
        .bind::<Text, _>(run.state.as_str())
        .bind::<diesel::sql_types::Nullable<diesel::sql_types::BigInt>, _>(run.started_at)
        .bind::<diesel::sql_types::Nullable<diesel::sql_types::BigInt>, _>(run.completed_at)
        .bind::<diesel::sql_types::Nullable<Text>, _>(&run.error)
        .bind::<diesel::sql_types::Nullable<Text>, _>(&run.parent_run_id)
        .bind::<diesel::sql_types::Nullable<Text>, _>(&run.parent_node_name)
        .bind::<diesel::sql_types::BigInt, _>(run.created_at)
        .execute(&mut conn)?;

        Ok(())
    }

    fn get_workflow_run(&self, run_id: &str) -> Result<Option<WorkflowRun>> {
        let mut conn = self.inner.conn()?;
        let rows: Vec<RunRow> = diesel::sql_query(
            "SELECT id, definition_id, params, state, started_at, completed_at, error,
                    parent_run_id, parent_node_name, created_at
             FROM workflow_runs WHERE id = ?",
        )
        .bind::<Text, _>(run_id)
        .load(&mut conn)?;

        Ok(rows.into_iter().next().map(run_from_row))
    }

    fn update_workflow_run_state(
        &self,
        run_id: &str,
        state: WorkflowState,
        error: Option<&str>,
    ) -> Result<()> {
        let mut conn = self.inner.conn()?;
        diesel::sql_query("UPDATE workflow_runs SET state = ?, error = ? WHERE id = ?")
            .bind::<Text, _>(state.as_str())
            .bind::<diesel::sql_types::Nullable<Text>, _>(error)
            .bind::<Text, _>(run_id)
            .execute(&mut conn)?;
        Ok(())
    }

    fn set_workflow_run_started(&self, run_id: &str, started_at: i64) -> Result<()> {
        let mut conn = self.inner.conn()?;
        diesel::sql_query(
            "UPDATE workflow_runs SET state = 'running', started_at = ? WHERE id = ?",
        )
        .bind::<diesel::sql_types::BigInt, _>(started_at)
        .bind::<Text, _>(run_id)
        .execute(&mut conn)?;
        Ok(())
    }

    fn set_workflow_run_completed(&self, run_id: &str, completed_at: i64) -> Result<()> {
        let mut conn = self.inner.conn()?;
        diesel::sql_query("UPDATE workflow_runs SET completed_at = ? WHERE id = ?")
            .bind::<diesel::sql_types::BigInt, _>(completed_at)
            .bind::<Text, _>(run_id)
            .execute(&mut conn)?;
        Ok(())
    }

    fn list_workflow_runs(
        &self,
        definition_name: Option<&str>,
        state: Option<WorkflowState>,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<WorkflowRun>> {
        let mut conn = self.inner.conn()?;

        let rows: Vec<RunRow> = match (definition_name, state) {
            (Some(name), Some(st)) => diesel::sql_query(
                "SELECT r.id, r.definition_id, r.params, r.state, r.started_at,
                        r.completed_at, r.error, r.parent_run_id, r.parent_node_name,
                        r.created_at
                 FROM workflow_runs r
                 JOIN workflow_definitions d ON r.definition_id = d.id
                 WHERE d.name = ? AND r.state = ?
                 ORDER BY r.created_at DESC LIMIT ? OFFSET ?",
            )
            .bind::<Text, _>(name)
            .bind::<Text, _>(st.as_str())
            .bind::<diesel::sql_types::BigInt, _>(limit)
            .bind::<diesel::sql_types::BigInt, _>(offset)
            .load(&mut conn)?,
            (Some(name), None) => diesel::sql_query(
                "SELECT r.id, r.definition_id, r.params, r.state, r.started_at,
                        r.completed_at, r.error, r.parent_run_id, r.parent_node_name,
                        r.created_at
                 FROM workflow_runs r
                 JOIN workflow_definitions d ON r.definition_id = d.id
                 WHERE d.name = ?
                 ORDER BY r.created_at DESC LIMIT ? OFFSET ?",
            )
            .bind::<Text, _>(name)
            .bind::<diesel::sql_types::BigInt, _>(limit)
            .bind::<diesel::sql_types::BigInt, _>(offset)
            .load(&mut conn)?,
            (None, Some(st)) => diesel::sql_query(
                "SELECT id, definition_id, params, state, started_at, completed_at,
                        error, parent_run_id, parent_node_name, created_at
                 FROM workflow_runs WHERE state = ?
                 ORDER BY created_at DESC LIMIT ? OFFSET ?",
            )
            .bind::<Text, _>(st.as_str())
            .bind::<diesel::sql_types::BigInt, _>(limit)
            .bind::<diesel::sql_types::BigInt, _>(offset)
            .load(&mut conn)?,
            (None, None) => diesel::sql_query(
                "SELECT id, definition_id, params, state, started_at, completed_at,
                        error, parent_run_id, parent_node_name, created_at
                 FROM workflow_runs
                 ORDER BY created_at DESC LIMIT ? OFFSET ?",
            )
            .bind::<diesel::sql_types::BigInt, _>(limit)
            .bind::<diesel::sql_types::BigInt, _>(offset)
            .load(&mut conn)?,
        };

        Ok(rows.into_iter().map(run_from_row).collect())
    }

    fn create_workflow_node(&self, node: &WorkflowNode) -> Result<()> {
        let mut conn = self.inner.conn()?;
        diesel::sql_query(
            "INSERT INTO workflow_nodes
                (id, run_id, node_name, job_id, status, result_hash,
                 fan_out_count, fan_in_data, started_at, completed_at, error)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind::<Text, _>(&node.id)
        .bind::<Text, _>(&node.run_id)
        .bind::<Text, _>(&node.node_name)
        .bind::<diesel::sql_types::Nullable<Text>, _>(&node.job_id)
        .bind::<Text, _>(node.status.as_str())
        .bind::<diesel::sql_types::Nullable<Text>, _>(&node.result_hash)
        .bind::<diesel::sql_types::Nullable<diesel::sql_types::Integer>, _>(node.fan_out_count)
        .bind::<diesel::sql_types::Nullable<Text>, _>(&node.fan_in_data)
        .bind::<diesel::sql_types::Nullable<diesel::sql_types::BigInt>, _>(node.started_at)
        .bind::<diesel::sql_types::Nullable<diesel::sql_types::BigInt>, _>(node.completed_at)
        .bind::<diesel::sql_types::Nullable<Text>, _>(&node.error)
        .execute(&mut conn)?;
        Ok(())
    }

    fn create_workflow_nodes_batch(&self, nodes: &[WorkflowNode]) -> Result<()> {
        let mut conn = self.inner.conn()?;
        for node in nodes {
            diesel::sql_query(
                "INSERT INTO workflow_nodes
                    (id, run_id, node_name, job_id, status, result_hash,
                     fan_out_count, fan_in_data, started_at, completed_at, error)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind::<Text, _>(&node.id)
            .bind::<Text, _>(&node.run_id)
            .bind::<Text, _>(&node.node_name)
            .bind::<diesel::sql_types::Nullable<Text>, _>(&node.job_id)
            .bind::<Text, _>(node.status.as_str())
            .bind::<diesel::sql_types::Nullable<Text>, _>(&node.result_hash)
            .bind::<diesel::sql_types::Nullable<diesel::sql_types::Integer>, _>(node.fan_out_count)
            .bind::<diesel::sql_types::Nullable<Text>, _>(&node.fan_in_data)
            .bind::<diesel::sql_types::Nullable<diesel::sql_types::BigInt>, _>(node.started_at)
            .bind::<diesel::sql_types::Nullable<diesel::sql_types::BigInt>, _>(node.completed_at)
            .bind::<diesel::sql_types::Nullable<Text>, _>(&node.error)
            .execute(&mut conn)?;
        }
        Ok(())
    }

    fn get_workflow_node(&self, run_id: &str, node_name: &str) -> Result<Option<WorkflowNode>> {
        let mut conn = self.inner.conn()?;
        let rows: Vec<NodeRow> = diesel::sql_query(
            "SELECT id, run_id, node_name, job_id, status, result_hash,
                    fan_out_count, fan_in_data, started_at, completed_at, error
             FROM workflow_nodes WHERE run_id = ? AND node_name = ?",
        )
        .bind::<Text, _>(run_id)
        .bind::<Text, _>(node_name)
        .load(&mut conn)?;

        Ok(rows.into_iter().next().map(node_from_row))
    }

    fn get_workflow_nodes(&self, run_id: &str) -> Result<Vec<WorkflowNode>> {
        let mut conn = self.inner.conn()?;
        let rows: Vec<NodeRow> = diesel::sql_query(
            "SELECT id, run_id, node_name, job_id, status, result_hash,
                    fan_out_count, fan_in_data, started_at, completed_at, error
             FROM workflow_nodes WHERE run_id = ?",
        )
        .bind::<Text, _>(run_id)
        .load(&mut conn)?;

        Ok(rows.into_iter().map(node_from_row).collect())
    }

    fn update_workflow_node_status(
        &self,
        run_id: &str,
        node_name: &str,
        status: WorkflowNodeStatus,
    ) -> Result<()> {
        let mut conn = self.inner.conn()?;
        diesel::sql_query(
            "UPDATE workflow_nodes SET status = ? WHERE run_id = ? AND node_name = ?",
        )
        .bind::<Text, _>(status.as_str())
        .bind::<Text, _>(run_id)
        .bind::<Text, _>(node_name)
        .execute(&mut conn)?;
        Ok(())
    }

    fn set_workflow_node_job(&self, run_id: &str, node_name: &str, job_id: &str) -> Result<()> {
        let mut conn = self.inner.conn()?;
        diesel::sql_query(
            "UPDATE workflow_nodes SET job_id = ? WHERE run_id = ? AND node_name = ?",
        )
        .bind::<Text, _>(job_id)
        .bind::<Text, _>(run_id)
        .bind::<Text, _>(node_name)
        .execute(&mut conn)?;
        Ok(())
    }

    fn set_workflow_node_started(
        &self,
        run_id: &str,
        node_name: &str,
        started_at: i64,
    ) -> Result<()> {
        let mut conn = self.inner.conn()?;
        diesel::sql_query(
            "UPDATE workflow_nodes SET status = 'running', started_at = ?
             WHERE run_id = ? AND node_name = ?",
        )
        .bind::<diesel::sql_types::BigInt, _>(started_at)
        .bind::<Text, _>(run_id)
        .bind::<Text, _>(node_name)
        .execute(&mut conn)?;
        Ok(())
    }

    fn set_workflow_node_completed(
        &self,
        run_id: &str,
        node_name: &str,
        completed_at: i64,
        result_hash: Option<&str>,
    ) -> Result<()> {
        let mut conn = self.inner.conn()?;
        diesel::sql_query(
            "UPDATE workflow_nodes SET status = 'completed', completed_at = ?, result_hash = ?
             WHERE run_id = ? AND node_name = ?",
        )
        .bind::<diesel::sql_types::BigInt, _>(completed_at)
        .bind::<diesel::sql_types::Nullable<Text>, _>(result_hash)
        .bind::<Text, _>(run_id)
        .bind::<Text, _>(node_name)
        .execute(&mut conn)?;
        Ok(())
    }

    fn set_workflow_node_error(&self, run_id: &str, node_name: &str, error: &str) -> Result<()> {
        let mut conn = self.inner.conn()?;
        diesel::sql_query(
            "UPDATE workflow_nodes SET status = 'failed', error = ?
             WHERE run_id = ? AND node_name = ?",
        )
        .bind::<Text, _>(error)
        .bind::<Text, _>(run_id)
        .bind::<Text, _>(node_name)
        .execute(&mut conn)?;
        Ok(())
    }

    fn set_workflow_node_fan_out_count(
        &self,
        run_id: &str,
        node_name: &str,
        count: i32,
    ) -> Result<()> {
        let mut conn = self.inner.conn()?;
        diesel::sql_query(
            "UPDATE workflow_nodes SET fan_out_count = ?, status = 'running'
             WHERE run_id = ? AND node_name = ?",
        )
        .bind::<diesel::sql_types::Integer, _>(count)
        .bind::<Text, _>(run_id)
        .bind::<Text, _>(node_name)
        .execute(&mut conn)?;
        Ok(())
    }

    fn get_workflow_nodes_by_prefix(
        &self,
        run_id: &str,
        prefix: &str,
    ) -> Result<Vec<WorkflowNode>> {
        let mut conn = self.inner.conn()?;
        let pattern = format!("{prefix}%");
        let rows: Vec<NodeRow> = diesel::sql_query(
            "SELECT id, run_id, node_name, job_id, status, result_hash,
                    fan_out_count, fan_in_data, started_at, completed_at, error
             FROM workflow_nodes WHERE run_id = ? AND node_name LIKE ?",
        )
        .bind::<Text, _>(run_id)
        .bind::<Text, _>(&pattern)
        .load(&mut conn)?;

        Ok(rows.into_iter().map(node_from_row).collect())
    }

    fn get_ready_workflow_nodes(&self, run_id: &str, dag_json: &str) -> Result<Vec<WorkflowNode>> {
        // Parse the DAG to find edges (predecessor relationships).
        let graph: dagron_core::SerializableGraph =
            serde_json::from_str(dag_json).map_err(|e| {
                taskito_core::error::QueueError::Serialization(format!(
                    "failed to deserialize workflow DAG: {e}"
                ))
            })?;

        // Build predecessor map: node_name → set of predecessor names.
        let mut predecessors: std::collections::HashMap<String, Vec<String>> =
            std::collections::HashMap::new();
        for node in &graph.nodes {
            predecessors.entry(node.name.clone()).or_default();
        }
        for edge in &graph.edges {
            predecessors
                .entry(edge.to.clone())
                .or_default()
                .push(edge.from.clone());
        }

        // Load all nodes for this run.
        let all_nodes = self.get_workflow_nodes(run_id)?;

        // Build an owned status lookup.
        let status_map: std::collections::HashMap<String, WorkflowNodeStatus> = all_nodes
            .iter()
            .map(|n| (n.node_name.clone(), n.status))
            .collect();

        // A node is ready if:
        //  1. Its status is Pending
        //  2. All its DAG predecessors have status Completed
        let ready: Vec<WorkflowNode> = all_nodes
            .into_iter()
            .filter(|node| {
                if node.status != WorkflowNodeStatus::Pending {
                    return false;
                }
                let preds = match predecessors.get(&node.node_name) {
                    Some(p) => p,
                    None => return true, // no predecessors → root node → ready
                };
                preds.iter().all(|pred_name| {
                    status_map.get(pred_name.as_str()).copied()
                        == Some(WorkflowNodeStatus::Completed)
                })
            })
            .collect();

        Ok(ready)
    }

    fn get_child_workflow_runs(&self, parent_run_id: &str) -> Result<Vec<WorkflowRun>> {
        let mut conn = self.inner.conn()?;
        let rows: Vec<RunRow> = diesel::sql_query(
            "SELECT id, definition_id, params, state, started_at, completed_at,
                    error, parent_run_id, parent_node_name, created_at
             FROM workflow_runs WHERE parent_run_id = ?",
        )
        .bind::<Text, _>(parent_run_id)
        .load(&mut conn)?;

        Ok(rows.into_iter().map(run_from_row).collect())
    }
}
