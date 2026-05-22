//! Fan-out expansion, deferred job creation, fan-out completion check.

use pyo3::exceptions::{PyRuntimeError, PyValueError};
use pyo3::prelude::*;

use taskito_core::error::Result as CoreResult;
use taskito_core::job::{now_millis, NewJob};
use taskito_core::storage::Storage;
use taskito_workflows::{WorkflowNode, WorkflowNodeStatus, WorkflowStorage};

use crate::py_queue::workflow_ops::{build_metadata_json, workflow_storage};
use crate::py_queue::PyQueue;

#[pymethods]
impl PyQueue {
    /// Expand a fan-out node into N child nodes + jobs.
    ///
    /// Creates one `WorkflowNode` and one job per child. Sets the parent
    /// node's `fan_out_count` and transitions it to `Running`. If the
    /// children list is empty (fan-out over empty result), the parent is
    /// marked `Completed` immediately.
    #[pyo3(signature = (
        run_id, parent_node_name, child_names, child_payloads,
        task_name, queue, max_retries, timeout_ms, priority
    ))]
    #[allow(clippy::too_many_arguments)]
    pub fn expand_fan_out(
        &self,
        py: Python<'_>,
        run_id: &str,
        parent_node_name: &str,
        child_names: Vec<String>,
        child_payloads: Vec<Vec<u8>>,
        task_name: &str,
        queue: &str,
        max_retries: i32,
        timeout_ms: i64,
        priority: i32,
    ) -> PyResult<Vec<String>> {
        if child_names.len() != child_payloads.len() {
            return Err(PyValueError::new_err(
                "child_names and child_payloads must have the same length",
            ));
        }

        let wf_storage = workflow_storage(self)?;
        let run_id_owned = run_id.to_string();
        let parent_name_owned = parent_node_name.to_string();
        let task_name_owned = task_name.to_string();
        let queue_owned = queue.to_string();

        let result: CoreResult<Vec<String>> = py.allow_threads(|| {
            let now = now_millis();
            let count = child_names.len() as i32;

            // Empty fan-out: mark parent completed immediately.
            if count == 0 {
                wf_storage.set_workflow_node_fan_out_count(&run_id_owned, &parent_name_owned, 0)?;
                wf_storage.set_workflow_node_completed(
                    &run_id_owned,
                    &parent_name_owned,
                    now,
                    None,
                )?;
                return Ok(Vec::new());
            }

            // Enqueue all child jobs first, then atomically batch-insert the
            // matching workflow_nodes. The batch insert wraps every row in one
            // transaction, so a crash partway through node creation no longer
            // leaves the run with half-tracked children.
            let mut child_job_ids = Vec::with_capacity(child_names.len());
            let mut wf_nodes = Vec::with_capacity(child_names.len());
            for (child_name, payload) in child_names.iter().zip(child_payloads.into_iter()) {
                let new_job = NewJob {
                    queue: queue_owned.clone(),
                    task_name: task_name_owned.clone(),
                    payload,
                    priority,
                    scheduled_at: now,
                    max_retries,
                    timeout_ms,
                    unique_key: None,
                    metadata: Some(build_metadata_json(&run_id_owned, child_name)),
                    notes: None,
                    depends_on: vec![],
                    expires_at: None,
                    result_ttl_ms: self.result_ttl_ms,
                    namespace: self.namespace.clone(),
                };
                let job = self.storage.enqueue(new_job)?;
                child_job_ids.push(job.id.clone());

                wf_nodes.push(WorkflowNode {
                    id: uuid::Uuid::now_v7().to_string(),
                    run_id: run_id_owned.clone(),
                    node_name: child_name.clone(),
                    job_id: Some(job.id),
                    status: WorkflowNodeStatus::Pending,
                    result_hash: None,
                    fan_out_count: None,
                    fan_in_data: None,
                    started_at: None,
                    completed_at: None,
                    error: None,
                });
            }

            wf_storage.create_workflow_nodes_batch(&wf_nodes)?;
            wf_storage.set_workflow_node_fan_out_count(&run_id_owned, &parent_name_owned, count)?;
            Ok(child_job_ids)
        });

        result.map_err(|e| PyRuntimeError::new_err(e.to_string()))
    }

    /// Create a job for a deferred workflow node.
    ///
    /// Used after fan-in collects results, or for static nodes downstream of
    /// dynamic nodes whose predecessors are now all complete.
    #[pyo3(signature = (run_id, node_name, payload, task_name, queue, max_retries, timeout_ms, priority))]
    #[allow(clippy::too_many_arguments)]
    pub fn create_deferred_job(
        &self,
        py: Python<'_>,
        run_id: &str,
        node_name: &str,
        payload: Vec<u8>,
        task_name: &str,
        queue: &str,
        max_retries: i32,
        timeout_ms: i64,
        priority: i32,
    ) -> PyResult<String> {
        let wf_storage = workflow_storage(self)?;
        let run_id_owned = run_id.to_string();
        let node_name_owned = node_name.to_string();
        let task_name_owned = task_name.to_string();
        let queue_owned = queue.to_string();

        let result: CoreResult<String> = py.allow_threads(|| {
            let now = now_millis();
            let new_job = NewJob {
                queue: queue_owned,
                task_name: task_name_owned,
                payload,
                priority,
                scheduled_at: now,
                max_retries,
                timeout_ms,
                unique_key: None,
                metadata: Some(build_metadata_json(&run_id_owned, &node_name_owned)),
                notes: None,
                depends_on: vec![],
                expires_at: None,
                result_ttl_ms: self.result_ttl_ms,
                namespace: self.namespace.clone(),
            };
            let job = self.storage.enqueue(new_job)?;
            wf_storage.set_workflow_node_job(&run_id_owned, &node_name_owned, &job.id)?;
            Ok(job.id)
        });

        result.map_err(|e| PyRuntimeError::new_err(e.to_string()))
    }

    /// Check whether all fan-out children of a parent node are terminal.
    ///
    /// When all children are terminal, performs an atomic compare-and-swap on
    /// the parent node's status to finalize it exactly once, even across
    /// concurrent callers. Returns `Some((all_succeeded, child_job_ids))` if
    /// this caller performed the transition, `None` otherwise (either not all
    /// children are done yet, or another concurrent caller already finalized).
    pub fn check_fan_out_completion(
        &self,
        py: Python<'_>,
        run_id: &str,
        parent_node_name: &str,
    ) -> PyResult<Option<(bool, Vec<String>)>> {
        let wf_storage = workflow_storage(self)?;
        let run_id_owned = run_id.to_string();
        let parent_name_owned = parent_node_name.to_string();

        let result: CoreResult<Option<(bool, Vec<String>)>> = py.allow_threads(|| {
            let prefix = format!("{parent_name_owned}[");
            let children = wf_storage.get_workflow_nodes_by_prefix(&run_id_owned, &prefix)?;

            if children.is_empty() || !children.iter().all(|n| n.status.is_terminal()) {
                return Ok(None);
            }

            let any_failed = children
                .iter()
                .any(|n| n.status == WorkflowNodeStatus::Failed);
            let child_job_ids: Vec<String> =
                children.iter().filter_map(|n| n.job_id.clone()).collect();

            let transitioned = wf_storage.finalize_fan_out_parent(
                &run_id_owned,
                &parent_name_owned,
                !any_failed,
                if any_failed {
                    Some("fan-out child failed")
                } else {
                    None
                },
                now_millis(),
            )?;
            if !transitioned {
                return Ok(None);
            }

            Ok(Some((!any_failed, child_job_ids)))
        });

        result.map_err(|e| PyRuntimeError::new_err(e.to_string()))
    }
}
