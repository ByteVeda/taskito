//! Workflow operations on `PyQueue`.
//!
//! Compiled only when the `workflows` feature is enabled. Each submodule
//! holds a partial `#[pymethods]` impl block (enabled by pyo3's
//! `multiple-pymethods` feature) grouped by concern: lifecycle, node
//! mutations, fan-out/fan-in, gates, and read-only queries. Helpers shared
//! across the submodules live in this file.

mod fan_out;
mod gates;
mod lifecycle;
mod nodes;
mod queries;

use std::collections::HashMap;

use pyo3::exceptions::{PyRuntimeError, PyValueError};
use pyo3::prelude::*;

use taskito_core::error::Result as CoreResult;
use taskito_core::storage::{Storage, StorageBackend};
use taskito_workflows::{
    StepMetadata, WorkflowNode, WorkflowNodeStatus, WorkflowSqliteStorage, WorkflowState,
    WorkflowStorage, WorkflowStorageBackend,
};

use crate::py_queue::PyQueue;

/// Return the queue's cached workflow storage, initializing it on first use.
///
/// Migrations run on first construction only; subsequent calls are a cheap
/// `OnceLock::get()`. Callers receive a cloned handle — every variant of
/// `WorkflowStorageBackend` wraps a pool handle so clones share the same
/// connection pool.
pub(super) fn workflow_storage(queue: &PyQueue) -> PyResult<WorkflowStorageBackend> {
    if let Some(wf) = queue.workflow_storage.get() {
        return Ok(wf.clone());
    }
    let wf = match &queue.storage {
        StorageBackend::Sqlite(s) => WorkflowSqliteStorage::new(s.clone())
            .map(WorkflowStorageBackend::Sqlite)
            .map_err(|e| PyRuntimeError::new_err(e.to_string()))?,
        #[cfg(feature = "postgres")]
        StorageBackend::Postgres(_) => {
            return Err(PyRuntimeError::new_err(
                "workflows are currently only supported on the SQLite backend",
            ))
        }
        #[cfg(feature = "redis")]
        StorageBackend::Redis(_) => {
            return Err(PyRuntimeError::new_err(
                "workflows are currently only supported on the SQLite backend",
            ))
        }
    };
    // If another thread raced us to initialize, our value is ignored — either
    // handle is equivalent because the underlying pool is shared.
    let _ = queue.workflow_storage.set(wf.clone());
    Ok(wf)
}

pub(super) fn parse_step_metadata(json: &str) -> PyResult<HashMap<String, StepMetadata>> {
    serde_json::from_str(json)
        .map_err(|e| PyValueError::new_err(format!("invalid step_metadata JSON: {e}")))
}

/// Build a job-metadata JSON blob that carries workflow routing info.
///
/// Uses `serde_json` to guarantee proper escaping of node names containing
/// backslashes, control characters, or Unicode — hand-rolled escaping previously
/// produced invalid JSON for such inputs.
pub(super) fn build_metadata_json(run_id: &str, node_name: &str) -> String {
    serde_json::json!({
        "workflow_run_id": run_id,
        "workflow_node_name": node_name,
    })
    .to_string()
}

pub(super) fn status_to_py(status: WorkflowState) -> String {
    status.as_str().to_string()
}

/// Mark every pending/ready node in a run as skipped and cancel its job.
///
/// Best-effort: per-node failures are logged but do not abort the sweep.
pub(super) fn cascade_skip_pending_nodes(
    storage: &StorageBackend,
    wf_storage: &WorkflowStorageBackend,
    run_id: &str,
    nodes: &[WorkflowNode],
) -> CoreResult<()> {
    for node in nodes {
        if !matches!(
            node.status,
            WorkflowNodeStatus::Pending | WorkflowNodeStatus::Ready
        ) {
            continue;
        }
        if let Some(job_id) = &node.job_id {
            if let Err(e) = storage.cancel_job(job_id) {
                log::warn!(
                    "[taskito] cancel_job({}) failed during cascade skip for run {}: {}",
                    job_id,
                    run_id,
                    e
                );
            }
        }
        if let Err(e) = wf_storage.update_workflow_node_status(
            run_id,
            &node.node_name,
            WorkflowNodeStatus::Skipped,
        ) {
            log::warn!(
                "[taskito] skip node '{}' failed for run {}: {}",
                node.node_name,
                run_id,
                e
            );
        }
    }
    Ok(())
}
