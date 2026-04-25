pub(crate) mod common;
mod definition;
pub(crate) mod diesel_common;
mod error;
mod node;
mod run;
pub mod sqlite_store;
mod state;
pub mod storage;
#[cfg(test)]
mod tests;
pub mod topology;

pub use dagron_core;
pub use definition::{StepMetadata, WorkflowDefinition};
pub use error::WorkflowError;
pub use node::{WorkflowNode, WorkflowNodeStatus};
pub use run::WorkflowRun;
pub use sqlite_store::WorkflowSqliteStorage;
pub use state::WorkflowState;
pub use storage::WorkflowStorage;
pub use topology::{topological_order, TopologicalNode};

use taskito_core::error::Result;

/// Backend-agnostic workflow storage handle.
///
/// Mirrors the `StorageBackend` enum in `taskito_core` so callers can hold a
/// single value regardless of which backend is active. PyO3 cannot hold
/// generic `#[pyclass]` types, so this enum (rather than `Box<dyn>`/generics)
/// is what `PyQueue` stashes in its `OnceLock`.
///
/// All variants are cheap to clone — each holds a pool handle internally.
#[derive(Clone)]
pub enum WorkflowStorageBackend {
    Sqlite(WorkflowSqliteStorage),
}

impl WorkflowStorage for WorkflowStorageBackend {
    fn create_workflow_definition(&self, def: &WorkflowDefinition) -> Result<()> {
        match self {
            Self::Sqlite(s) => s.create_workflow_definition(def),
        }
    }

    fn get_workflow_definition(
        &self,
        name: &str,
        version: Option<i32>,
    ) -> Result<Option<WorkflowDefinition>> {
        match self {
            Self::Sqlite(s) => s.get_workflow_definition(name, version),
        }
    }

    fn get_workflow_definition_by_id(&self, id: &str) -> Result<Option<WorkflowDefinition>> {
        match self {
            Self::Sqlite(s) => s.get_workflow_definition_by_id(id),
        }
    }

    fn create_workflow_run(&self, run: &WorkflowRun) -> Result<()> {
        match self {
            Self::Sqlite(s) => s.create_workflow_run(run),
        }
    }

    fn get_workflow_run(&self, run_id: &str) -> Result<Option<WorkflowRun>> {
        match self {
            Self::Sqlite(s) => s.get_workflow_run(run_id),
        }
    }

    fn update_workflow_run_state(
        &self,
        run_id: &str,
        state: WorkflowState,
        error: Option<&str>,
    ) -> Result<()> {
        match self {
            Self::Sqlite(s) => s.update_workflow_run_state(run_id, state, error),
        }
    }

    fn set_workflow_run_started(&self, run_id: &str, started_at: i64) -> Result<()> {
        match self {
            Self::Sqlite(s) => s.set_workflow_run_started(run_id, started_at),
        }
    }

    fn set_workflow_run_completed(&self, run_id: &str, completed_at: i64) -> Result<()> {
        match self {
            Self::Sqlite(s) => s.set_workflow_run_completed(run_id, completed_at),
        }
    }

    fn list_workflow_runs(
        &self,
        definition_name: Option<&str>,
        state: Option<WorkflowState>,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<WorkflowRun>> {
        match self {
            Self::Sqlite(s) => s.list_workflow_runs(definition_name, state, limit, offset),
        }
    }

    fn create_workflow_node(&self, node: &WorkflowNode) -> Result<()> {
        match self {
            Self::Sqlite(s) => s.create_workflow_node(node),
        }
    }

    fn create_workflow_nodes_batch(&self, nodes: &[WorkflowNode]) -> Result<()> {
        match self {
            Self::Sqlite(s) => s.create_workflow_nodes_batch(nodes),
        }
    }

    fn get_workflow_node(&self, run_id: &str, node_name: &str) -> Result<Option<WorkflowNode>> {
        match self {
            Self::Sqlite(s) => s.get_workflow_node(run_id, node_name),
        }
    }

    fn get_workflow_nodes(&self, run_id: &str) -> Result<Vec<WorkflowNode>> {
        match self {
            Self::Sqlite(s) => s.get_workflow_nodes(run_id),
        }
    }

    fn update_workflow_node_status(
        &self,
        run_id: &str,
        node_name: &str,
        status: WorkflowNodeStatus,
    ) -> Result<()> {
        match self {
            Self::Sqlite(s) => s.update_workflow_node_status(run_id, node_name, status),
        }
    }

    fn set_workflow_node_job(&self, run_id: &str, node_name: &str, job_id: &str) -> Result<()> {
        match self {
            Self::Sqlite(s) => s.set_workflow_node_job(run_id, node_name, job_id),
        }
    }

    fn set_workflow_node_started(
        &self,
        run_id: &str,
        node_name: &str,
        started_at: i64,
    ) -> Result<()> {
        match self {
            Self::Sqlite(s) => s.set_workflow_node_started(run_id, node_name, started_at),
        }
    }

    fn set_workflow_node_completed(
        &self,
        run_id: &str,
        node_name: &str,
        completed_at: i64,
        result_hash: Option<&str>,
    ) -> Result<()> {
        match self {
            Self::Sqlite(s) => {
                s.set_workflow_node_completed(run_id, node_name, completed_at, result_hash)
            }
        }
    }

    fn set_workflow_node_error(&self, run_id: &str, node_name: &str, error: &str) -> Result<()> {
        match self {
            Self::Sqlite(s) => s.set_workflow_node_error(run_id, node_name, error),
        }
    }

    fn get_ready_workflow_nodes(&self, run_id: &str, dag_json: &str) -> Result<Vec<WorkflowNode>> {
        match self {
            Self::Sqlite(s) => s.get_ready_workflow_nodes(run_id, dag_json),
        }
    }

    fn set_workflow_node_fan_out_count(
        &self,
        run_id: &str,
        node_name: &str,
        count: i32,
    ) -> Result<()> {
        match self {
            Self::Sqlite(s) => s.set_workflow_node_fan_out_count(run_id, node_name, count),
        }
    }

    fn set_workflow_node_running(
        &self,
        run_id: &str,
        node_name: &str,
        started_at: i64,
    ) -> Result<()> {
        match self {
            Self::Sqlite(s) => s.set_workflow_node_running(run_id, node_name, started_at),
        }
    }

    fn finalize_fan_out_parent(
        &self,
        run_id: &str,
        node_name: &str,
        succeeded: bool,
        error: Option<&str>,
        completed_at: i64,
    ) -> Result<bool> {
        match self {
            Self::Sqlite(s) => {
                s.finalize_fan_out_parent(run_id, node_name, succeeded, error, completed_at)
            }
        }
    }

    fn get_workflow_nodes_by_prefix(
        &self,
        run_id: &str,
        prefix: &str,
    ) -> Result<Vec<WorkflowNode>> {
        match self {
            Self::Sqlite(s) => s.get_workflow_nodes_by_prefix(run_id, prefix),
        }
    }

    fn get_child_workflow_runs(&self, parent_run_id: &str) -> Result<Vec<WorkflowRun>> {
        match self {
            Self::Sqlite(s) => s.get_child_workflow_runs(parent_run_id),
        }
    }
}
