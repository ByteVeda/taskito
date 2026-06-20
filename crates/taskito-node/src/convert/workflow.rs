//! JS-facing shapes for workflow runs and nodes. State enums are surfaced as
//! their lowercase string names (matching the rest of the SDK and the dashboard
//! contract).

use napi_derive::napi;
use taskito_workflows::{WorkflowNode, WorkflowRun};

/// JS-facing view of a [`WorkflowRun`].
#[napi(object)]
pub struct JsWorkflowRun {
    pub id: String,
    pub definition_id: String,
    /// Lowercase run state: `pending`, `running`, `completed`, `failed`,
    /// `cancelled`, `completed_with_failures`, …
    pub state: String,
    pub params: Option<String>,
    pub error: Option<String>,
    pub started_at: Option<i64>,
    pub completed_at: Option<i64>,
    pub created_at: i64,
    pub parent_run_id: Option<String>,
    pub parent_node_name: Option<String>,
}

/// JS-facing view of a [`WorkflowNode`] (one step of a run).
#[napi(object)]
pub struct JsWorkflowNode {
    pub run_id: String,
    pub node_name: String,
    pub job_id: Option<String>,
    /// Lowercase node status: `pending`, `ready`, `running`, `completed`,
    /// `failed`, `skipped`, …
    pub status: String,
    pub error: Option<String>,
    pub result_hash: Option<String>,
    pub started_at: Option<i64>,
    pub completed_at: Option<i64>,
}

/// Result of advancing a workflow node — returned by `markWorkflowNodeResult`.
/// `finalState` is set only when the whole run reached a terminal state.
#[napi(object)]
pub struct JsWorkflowAdvance {
    pub run_id: String,
    pub node_name: String,
    pub final_state: Option<String>,
}

pub fn run_to_js(run: WorkflowRun) -> JsWorkflowRun {
    JsWorkflowRun {
        id: run.id,
        definition_id: run.definition_id,
        state: run.state.as_str().to_string(),
        params: run.params,
        error: run.error,
        started_at: run.started_at,
        completed_at: run.completed_at,
        created_at: run.created_at,
        parent_run_id: run.parent_run_id,
        parent_node_name: run.parent_node_name,
    }
}

pub fn node_to_js(node: WorkflowNode) -> JsWorkflowNode {
    JsWorkflowNode {
        run_id: node.run_id,
        node_name: node.node_name,
        job_id: node.job_id,
        status: node.status.as_str().to_string(),
        error: node.error,
        result_hash: node.result_hash,
        started_at: node.started_at,
        completed_at: node.completed_at,
    }
}
