use taskito_core::error::Result;

use crate::{WorkflowDefinition, WorkflowNode, WorkflowNodeStatus, WorkflowRun, WorkflowState};

/// Storage operations for workflows.
///
/// Kept as a separate trait from `Storage` so that the workflow feature
/// doesn't bloat the core trait or require feature-gated methods everywhere.
pub trait WorkflowStorage: Send + Sync {
    // ── Definitions ────────────────────────────────────────────────

    fn create_workflow_definition(&self, def: &WorkflowDefinition) -> Result<()>;
    fn get_workflow_definition(
        &self,
        name: &str,
        version: Option<i32>,
    ) -> Result<Option<WorkflowDefinition>>;
    fn get_workflow_definition_by_id(&self, id: &str) -> Result<Option<WorkflowDefinition>>;

    // ── Runs ───────────────────────────────────────────────────────

    fn create_workflow_run(&self, run: &WorkflowRun) -> Result<()>;
    fn get_workflow_run(&self, run_id: &str) -> Result<Option<WorkflowRun>>;
    fn update_workflow_run_state(
        &self,
        run_id: &str,
        state: WorkflowState,
        error: Option<&str>,
    ) -> Result<()>;
    fn set_workflow_run_started(&self, run_id: &str, started_at: i64) -> Result<()>;
    fn set_workflow_run_completed(&self, run_id: &str, completed_at: i64) -> Result<()>;
    fn list_workflow_runs(
        &self,
        definition_name: Option<&str>,
        state: Option<WorkflowState>,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<WorkflowRun>>;

    // ── Nodes ──────────────────────────────────────────────────────

    fn create_workflow_node(&self, node: &WorkflowNode) -> Result<()>;
    fn create_workflow_nodes_batch(&self, nodes: &[WorkflowNode]) -> Result<()>;
    fn get_workflow_node(&self, run_id: &str, node_name: &str) -> Result<Option<WorkflowNode>>;
    fn get_workflow_nodes(&self, run_id: &str) -> Result<Vec<WorkflowNode>>;
    fn update_workflow_node_status(
        &self,
        run_id: &str,
        node_name: &str,
        status: WorkflowNodeStatus,
    ) -> Result<()>;
    fn set_workflow_node_job(&self, run_id: &str, node_name: &str, job_id: &str) -> Result<()>;
    fn set_workflow_node_started(
        &self,
        run_id: &str,
        node_name: &str,
        started_at: i64,
    ) -> Result<()>;
    fn set_workflow_node_completed(
        &self,
        run_id: &str,
        node_name: &str,
        completed_at: i64,
        result_hash: Option<&str>,
    ) -> Result<()>;
    fn set_workflow_node_error(&self, run_id: &str, node_name: &str, error: &str) -> Result<()>;

    /// Return nodes whose status is `Pending` and all DAG predecessors are `Completed`.
    ///
    /// The `dag_json` parameter is the serialized DAG from the workflow definition.
    /// The implementation uses it to determine which predecessor nodes must be
    /// complete before a given node becomes ready.
    fn get_ready_workflow_nodes(&self, run_id: &str, dag_json: &str) -> Result<Vec<WorkflowNode>>;

    // ── Fan-out / Fan-in ──────────────────────────────────────────

    /// Set a node's `fan_out_count` and transition its status to `Running`.
    fn set_workflow_node_fan_out_count(
        &self,
        run_id: &str,
        node_name: &str,
        count: i32,
    ) -> Result<()>;

    /// Return all nodes whose `node_name` starts with `prefix`.
    ///
    /// Used to find fan-out children (e.g., prefix `"process["` returns
    /// `process[0]`, `process[1]`, etc.).
    fn get_workflow_nodes_by_prefix(&self, run_id: &str, prefix: &str)
        -> Result<Vec<WorkflowNode>>;

    /// Return all child workflow runs of a parent run.
    fn get_child_workflow_runs(&self, parent_run_id: &str) -> Result<Vec<WorkflowRun>>;
}
