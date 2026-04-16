//! Workflow operations on `PyQueue`.
//!
//! Compiled only when the `workflows` feature is enabled. Adds
//! workflow-specific methods to `PyQueue` via a separate `#[pymethods]`
//! impl block (enabled by pyo3's `multiple-pymethods` feature).

use std::collections::HashMap;

use pyo3::exceptions::{PyRuntimeError, PyValueError};
use pyo3::prelude::*;

use taskito_core::job::{now_millis, NewJob};
use taskito_core::storage::{Storage, StorageBackend};
use taskito_workflows::{
    topological_order, StepMetadata, WorkflowNode, WorkflowNodeStatus, WorkflowRun,
    WorkflowSqliteStorage, WorkflowState, WorkflowStorage,
};

use crate::py_queue::PyQueue;
use crate::py_workflow::{PyWorkflowHandle, PyWorkflowRunStatus};

/// Build a `WorkflowSqliteStorage` from a `PyQueue`'s backend.
///
/// Currently only SQLite is supported for workflows. Migrations run on
/// construction; repeated calls are cheap because the migrations use
/// `CREATE TABLE IF NOT EXISTS`.
fn workflow_storage(queue: &PyQueue) -> PyResult<WorkflowSqliteStorage> {
    match &queue.storage {
        StorageBackend::Sqlite(s) => WorkflowSqliteStorage::new(s.clone())
            .map_err(|e| PyRuntimeError::new_err(e.to_string())),
        #[cfg(feature = "postgres")]
        StorageBackend::Postgres(_) => Err(PyRuntimeError::new_err(
            "workflows are currently only supported on the SQLite backend",
        )),
        #[cfg(feature = "redis")]
        StorageBackend::Redis(_) => Err(PyRuntimeError::new_err(
            "workflows are currently only supported on the SQLite backend",
        )),
    }
}

fn parse_step_metadata(json: &str) -> PyResult<HashMap<String, StepMetadata>> {
    serde_json::from_str(json)
        .map_err(|e| PyValueError::new_err(format!("invalid step_metadata JSON: {e}")))
}

fn build_metadata_json(run_id: &str, node_name: &str) -> String {
    format!(
        r#"{{"workflow_run_id":"{}","workflow_node_name":"{}"}}"#,
        run_id.replace('"', "\\\""),
        node_name.replace('"', "\\\""),
    )
}

fn status_to_py(status: WorkflowState) -> String {
    status.as_str().to_string()
}

#[pymethods]
impl PyQueue {
    /// Submit a workflow for execution.
    ///
    /// Creates (or reuses) a `WorkflowDefinition` with the given name + version,
    /// inserts a `WorkflowRun`, pre-enqueues all step jobs in topological order
    /// with `depends_on` chains so taskito's existing scheduler runs them in the
    /// correct order. Nodes listed in `deferred_node_names` get a
    /// `WorkflowNode` only (no job) — their jobs are created at runtime by the
    /// Python tracker (fan-out / fan-in orchestration).
    ///
    /// Returns a `PyWorkflowHandle` carrying the run id.
    #[pyo3(signature = (
        name, version, dag_bytes, step_metadata_json, node_payloads,
        queue_default="default", params_json=None, deferred_node_names=None,
        parent_run_id=None, parent_node_name=None, cache_hit_nodes=None
    ))]
    #[allow(clippy::too_many_arguments)]
    pub fn submit_workflow(
        &self,
        name: &str,
        version: i32,
        dag_bytes: Vec<u8>,
        step_metadata_json: &str,
        node_payloads: HashMap<String, Vec<u8>>,
        queue_default: &str,
        params_json: Option<String>,
        deferred_node_names: Option<Vec<String>>,
        parent_run_id: Option<String>,
        parent_node_name: Option<String>,
        cache_hit_nodes: Option<HashMap<String, String>>,
    ) -> PyResult<PyWorkflowHandle> {
        let wf_storage = workflow_storage(self)?;
        let step_meta = parse_step_metadata(step_metadata_json)?;
        let ordered =
            topological_order(&dag_bytes).map_err(|e| PyRuntimeError::new_err(e.to_string()))?;

        let deferred: std::collections::HashSet<String> = deferred_node_names
            .unwrap_or_default()
            .into_iter()
            .collect();
        let cached: HashMap<String, String> = cache_hit_nodes.unwrap_or_default();

        let definition_id = match wf_storage
            .get_workflow_definition(name, Some(version))
            .map_err(|e| PyRuntimeError::new_err(e.to_string()))?
        {
            Some(existing) => existing.id,
            None => {
                let def = taskito_workflows::WorkflowDefinition {
                    id: uuid::Uuid::now_v7().to_string(),
                    name: name.to_string(),
                    version,
                    dag_data: dag_bytes.clone(),
                    step_metadata: step_meta.clone(),
                    created_at: now_millis(),
                };
                let def_id = def.id.clone();
                wf_storage
                    .create_workflow_definition(&def)
                    .map_err(|e| PyRuntimeError::new_err(e.to_string()))?;
                def_id
            }
        };

        let run_id = uuid::Uuid::now_v7().to_string();
        let now = now_millis();
        let run = WorkflowRun {
            id: run_id.clone(),
            definition_id: definition_id.clone(),
            params: params_json,
            state: WorkflowState::Pending,
            started_at: Some(now),
            completed_at: None,
            error: None,
            parent_run_id,
            parent_node_name,
            created_at: now,
        };
        wf_storage
            .create_workflow_run(&run)
            .map_err(|e| PyRuntimeError::new_err(e.to_string()))?;

        let mut job_ids: HashMap<String, String> = HashMap::new();
        for topo in &ordered {
            // Deferred nodes get a WorkflowNode only — no job.
            // Cache-hit nodes: copy result_hash from base run, no job.
            if let Some(rh) = cached.get(&topo.name) {
                let wf_node = WorkflowNode {
                    id: uuid::Uuid::now_v7().to_string(),
                    run_id: run_id.clone(),
                    node_name: topo.name.clone(),
                    job_id: None,
                    status: WorkflowNodeStatus::CacheHit,
                    result_hash: Some(rh.clone()),
                    fan_out_count: None,
                    fan_in_data: None,
                    started_at: None,
                    completed_at: Some(now),
                    error: None,
                };
                wf_storage
                    .create_workflow_node(&wf_node)
                    .map_err(|e| PyRuntimeError::new_err(e.to_string()))?;
                continue;
            }

            // Deferred nodes: WorkflowNode only, no job.
            if deferred.contains(&topo.name) {
                let wf_node = WorkflowNode {
                    id: uuid::Uuid::now_v7().to_string(),
                    run_id: run_id.clone(),
                    node_name: topo.name.clone(),
                    job_id: None,
                    status: WorkflowNodeStatus::Pending,
                    result_hash: None,
                    fan_out_count: None,
                    fan_in_data: None,
                    started_at: None,
                    completed_at: None,
                    error: None,
                };
                wf_storage
                    .create_workflow_node(&wf_node)
                    .map_err(|e| PyRuntimeError::new_err(e.to_string()))?;
                continue;
            }

            let meta = step_meta.get(&topo.name).ok_or_else(|| {
                PyValueError::new_err(format!("step '{}' missing from step_metadata", topo.name))
            })?;
            let payload = node_payloads.get(&topo.name).cloned().ok_or_else(|| {
                PyValueError::new_err(format!("step '{}' missing from node_payloads", topo.name))
            })?;

            // Only resolve depends_on for non-deferred predecessors.
            let depends_on: Vec<String> = topo
                .predecessors
                .iter()
                .filter(|p| !deferred.contains(*p))
                .map(|p| {
                    job_ids.get(p).cloned().ok_or_else(|| {
                        PyValueError::new_err(format!(
                            "predecessor '{}' of step '{}' has no job id",
                            p, topo.name
                        ))
                    })
                })
                .collect::<PyResult<Vec<_>>>()?;

            let timeout_ms = meta.timeout_ms.unwrap_or(self.default_timeout * 1000);
            let new_job = NewJob {
                queue: meta
                    .queue
                    .clone()
                    .unwrap_or_else(|| queue_default.to_string()),
                task_name: meta.task_name.clone(),
                payload,
                priority: meta.priority.unwrap_or(self.default_priority),
                scheduled_at: now,
                max_retries: meta.max_retries.unwrap_or(self.default_retry),
                timeout_ms,
                unique_key: None,
                metadata: Some(build_metadata_json(&run_id, &topo.name)),
                depends_on,
                expires_at: None,
                result_ttl_ms: self.result_ttl_ms,
                namespace: self.namespace.clone(),
            };

            let job = self
                .storage
                .enqueue(new_job)
                .map_err(|e| PyRuntimeError::new_err(e.to_string()))?;
            job_ids.insert(topo.name.clone(), job.id.clone());

            let wf_node = WorkflowNode {
                id: uuid::Uuid::now_v7().to_string(),
                run_id: run_id.clone(),
                node_name: topo.name.clone(),
                job_id: Some(job.id),
                status: WorkflowNodeStatus::Pending,
                result_hash: None,
                fan_out_count: None,
                fan_in_data: None,
                started_at: None,
                completed_at: None,
                error: None,
            };
            wf_storage
                .create_workflow_node(&wf_node)
                .map_err(|e| PyRuntimeError::new_err(e.to_string()))?;
        }

        wf_storage
            .update_workflow_run_state(&run_id, WorkflowState::Running, None)
            .map_err(|e| PyRuntimeError::new_err(e.to_string()))?;

        Ok(PyWorkflowHandle {
            run_id,
            name: name.to_string(),
            definition_id,
        })
    }

    /// Fetch a snapshot of a workflow run's state and per-node status.
    pub fn get_workflow_run_status(&self, run_id: &str) -> PyResult<PyWorkflowRunStatus> {
        let wf_storage = workflow_storage(self)?;
        let run = wf_storage
            .get_workflow_run(run_id)
            .map_err(|e| PyRuntimeError::new_err(e.to_string()))?
            .ok_or_else(|| PyValueError::new_err(format!("workflow run '{run_id}' not found")))?;

        let nodes = wf_storage
            .get_workflow_nodes(run_id)
            .map_err(|e| PyRuntimeError::new_err(e.to_string()))?;

        let node_rows = nodes
            .into_iter()
            .map(|n| {
                (
                    n.node_name,
                    n.status.as_str().to_string(),
                    n.job_id,
                    n.error,
                )
            })
            .collect();

        Ok(PyWorkflowRunStatus {
            run_id: run.id,
            state: status_to_py(run.state),
            started_at: run.started_at,
            completed_at: run.completed_at,
            error: run.error,
            nodes: node_rows,
        })
    }

    /// Cancel a workflow run.
    ///
    /// Marks the run `Cancelled`, skips any pending nodes, and cancels
    /// their underlying jobs. Nodes already running are left alone
    /// (consistent with taskito's existing cancel semantics).
    pub fn cancel_workflow_run(&self, run_id: &str) -> PyResult<()> {
        let wf_storage = workflow_storage(self)?;
        let nodes = wf_storage
            .get_workflow_nodes(run_id)
            .map_err(|e| PyRuntimeError::new_err(e.to_string()))?;

        for node in &nodes {
            if matches!(
                node.status,
                WorkflowNodeStatus::Pending | WorkflowNodeStatus::Ready
            ) {
                if let Some(job_id) = &node.job_id {
                    let _ = self.storage.cancel_job(job_id);
                }
                let _ = wf_storage.update_workflow_node_status(
                    run_id,
                    &node.node_name,
                    WorkflowNodeStatus::Skipped,
                );
            }
        }

        wf_storage
            .update_workflow_run_state(run_id, WorkflowState::Cancelled, None)
            .map_err(|e| PyRuntimeError::new_err(e.to_string()))?;
        wf_storage
            .set_workflow_run_completed(run_id, now_millis())
            .map_err(|e| PyRuntimeError::new_err(e.to_string()))?;

        // Cascade cancellation to child workflow runs (sub-workflows).
        if let Ok(children) = wf_storage.get_child_workflow_runs(run_id) {
            for child in children {
                if !child.state.is_terminal() {
                    let _ = self.cancel_workflow_run(&child.id);
                }
            }
        }

        Ok(())
    }

    /// Record the terminal outcome of a workflow node's job.
    ///
    /// Called by the Python workflow tracker in response to
    /// `JOB_COMPLETED`/`JOB_FAILED`/`JOB_DEAD`/`JOB_CANCELLED` events.
    /// On failure, walks remaining pending nodes in the run and skips them
    /// (fail-fast semantics) unless ``skip_cascade`` is true. When the run
    /// transitions to a terminal state, returns
    /// `(run_id, node_name, final_state_str)`. Otherwise returns
    /// `(run_id, node_name, None)` so the tracker can decide whether to
    /// trigger fan-out expansion or fan-in collection.
    ///
    /// Set ``skip_cascade=True`` for tracker-managed runs (those with
    /// conditions or ``on_failure="continue"``) so the Python tracker can
    /// handle selective skip/create decisions.
    #[pyo3(signature = (job_id, succeeded, error=None, skip_cascade=false, result_hash=None))]
    pub fn mark_workflow_node_result(
        &self,
        job_id: &str,
        succeeded: bool,
        error: Option<String>,
        skip_cascade: bool,
        result_hash: Option<String>,
    ) -> PyResult<Option<(String, String, Option<String>)>> {
        let wf_storage = workflow_storage(self)?;
        let job = self
            .storage
            .get_job(job_id)
            .map_err(|e| PyRuntimeError::new_err(e.to_string()))?
            .ok_or_else(|| PyValueError::new_err(format!("job '{job_id}' not found")))?;

        let metadata_json = match &job.metadata {
            Some(m) => m,
            None => return Ok(None),
        };
        let parsed: serde_json::Value = match serde_json::from_str(metadata_json) {
            Ok(v) => v,
            Err(_) => return Ok(None),
        };
        let run_id = match parsed.get("workflow_run_id").and_then(|v| v.as_str()) {
            Some(id) => id.to_string(),
            None => return Ok(None),
        };
        let node_name = match parsed.get("workflow_node_name").and_then(|v| v.as_str()) {
            Some(n) => n.to_string(),
            None => return Ok(None),
        };

        let now = now_millis();
        if succeeded {
            wf_storage
                .set_workflow_node_completed(&run_id, &node_name, now, result_hash.as_deref())
                .map_err(|e| PyRuntimeError::new_err(e.to_string()))?;
        } else {
            let err_msg = error.clone().unwrap_or_else(|| "failed".to_string());
            wf_storage
                .set_workflow_node_error(&run_id, &node_name, &err_msg)
                .map_err(|e| PyRuntimeError::new_err(e.to_string()))?;
        }

        // Fail-fast: cascade failure to pending/ready nodes.
        // Skipped when the Python tracker manages cascade (conditions / continue mode).
        if !succeeded && !skip_cascade {
            let nodes = wf_storage
                .get_workflow_nodes(&run_id)
                .map_err(|e| PyRuntimeError::new_err(e.to_string()))?;
            for n in &nodes {
                if matches!(
                    n.status,
                    WorkflowNodeStatus::Pending | WorkflowNodeStatus::Ready
                ) {
                    if let Some(j) = &n.job_id {
                        let _ = self.storage.cancel_job(j);
                    }
                    let _ = wf_storage.update_workflow_node_status(
                        &run_id,
                        &n.node_name,
                        WorkflowNodeStatus::Skipped,
                    );
                }
            }
        }

        // Note: fan-out parent status is NOT updated here. The Python
        // tracker calls `check_fan_out_completion` which atomically marks
        // the parent and triggers fan-in. Doing it here would race.

        // Check if the entire run is terminal.
        let nodes = wf_storage
            .get_workflow_nodes(&run_id)
            .map_err(|e| PyRuntimeError::new_err(e.to_string()))?;
        let all_terminal = nodes.iter().all(|n| n.status.is_terminal());
        if !all_terminal {
            return Ok(Some((run_id, node_name, None)));
        }

        let any_failed = nodes.iter().any(|n| n.status == WorkflowNodeStatus::Failed);
        let final_state = if any_failed || !succeeded {
            WorkflowState::Failed
        } else {
            WorkflowState::Completed
        };

        wf_storage
            .update_workflow_run_state(
                &run_id,
                final_state,
                if final_state == WorkflowState::Failed {
                    error.as_deref()
                } else {
                    None
                },
            )
            .map_err(|e| PyRuntimeError::new_err(e.to_string()))?;
        wf_storage
            .set_workflow_run_completed(&run_id, now)
            .map_err(|e| PyRuntimeError::new_err(e.to_string()))?;

        Ok(Some((
            run_id,
            node_name,
            Some(final_state.as_str().to_string()),
        )))
    }

    // ── Fan-out / Fan-in helpers ────────────────────────────────

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
        let now = now_millis();
        let count = child_names.len() as i32;

        // Empty fan-out: mark parent completed immediately.
        if count == 0 {
            wf_storage
                .set_workflow_node_fan_out_count(run_id, parent_node_name, 0)
                .map_err(|e| PyRuntimeError::new_err(e.to_string()))?;
            wf_storage
                .set_workflow_node_completed(run_id, parent_node_name, now, None)
                .map_err(|e| PyRuntimeError::new_err(e.to_string()))?;
            return Ok(vec![]);
        }

        let mut child_job_ids = Vec::with_capacity(child_names.len());

        for (child_name, payload) in child_names.iter().zip(child_payloads.into_iter()) {
            let new_job = NewJob {
                queue: queue.to_string(),
                task_name: task_name.to_string(),
                payload,
                priority,
                scheduled_at: now,
                max_retries,
                timeout_ms,
                unique_key: None,
                metadata: Some(build_metadata_json(run_id, child_name)),
                depends_on: vec![],
                expires_at: None,
                result_ttl_ms: self.result_ttl_ms,
                namespace: self.namespace.clone(),
            };

            let job = self
                .storage
                .enqueue(new_job)
                .map_err(|e| PyRuntimeError::new_err(e.to_string()))?;
            child_job_ids.push(job.id.clone());

            let wf_node = WorkflowNode {
                id: uuid::Uuid::now_v7().to_string(),
                run_id: run_id.to_string(),
                node_name: child_name.clone(),
                job_id: Some(job.id),
                status: WorkflowNodeStatus::Pending,
                result_hash: None,
                fan_out_count: None,
                fan_in_data: None,
                started_at: None,
                completed_at: None,
                error: None,
            };
            wf_storage
                .create_workflow_node(&wf_node)
                .map_err(|e| PyRuntimeError::new_err(e.to_string()))?;
        }

        wf_storage
            .set_workflow_node_fan_out_count(run_id, parent_node_name, count)
            .map_err(|e| PyRuntimeError::new_err(e.to_string()))?;

        Ok(child_job_ids)
    }

    /// Create a job for a deferred workflow node.
    ///
    /// Used after fan-in collects results, or for static nodes downstream of
    /// dynamic nodes whose predecessors are now all complete.
    #[pyo3(signature = (run_id, node_name, payload, task_name, queue, max_retries, timeout_ms, priority))]
    #[allow(clippy::too_many_arguments)]
    pub fn create_deferred_job(
        &self,
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
        let now = now_millis();

        let new_job = NewJob {
            queue: queue.to_string(),
            task_name: task_name.to_string(),
            payload,
            priority,
            scheduled_at: now,
            max_retries,
            timeout_ms,
            unique_key: None,
            metadata: Some(build_metadata_json(run_id, node_name)),
            depends_on: vec![],
            expires_at: None,
            result_ttl_ms: self.result_ttl_ms,
            namespace: self.namespace.clone(),
        };

        let job = self
            .storage
            .enqueue(new_job)
            .map_err(|e| PyRuntimeError::new_err(e.to_string()))?;

        wf_storage
            .set_workflow_node_job(run_id, node_name, &job.id)
            .map_err(|e| PyRuntimeError::new_err(e.to_string()))?;

        Ok(job.id)
    }

    /// Check whether all fan-out children of a parent node are terminal.
    ///
    /// If all children are terminal, atomically marks the parent node as
    /// `Completed` (all succeeded) or `Failed` (any failed) and returns
    /// `Some((all_succeeded, child_job_ids))`. Returns `None` if not all
    /// children are done yet or if the parent was already finalized by a
    /// concurrent call.
    pub fn check_fan_out_completion(
        &self,
        run_id: &str,
        parent_node_name: &str,
    ) -> PyResult<Option<(bool, Vec<String>)>> {
        let wf_storage = workflow_storage(self)?;

        // Guard: if the parent is already terminal, another call beat us.
        let parent = wf_storage
            .get_workflow_node(run_id, parent_node_name)
            .map_err(|e| PyRuntimeError::new_err(e.to_string()))?
            .ok_or_else(|| {
                PyValueError::new_err(format!(
                    "workflow node '{parent_node_name}' not found in run '{run_id}'"
                ))
            })?;
        if parent.status.is_terminal() {
            return Ok(None);
        }

        let children = wf_storage
            .get_workflow_nodes_by_prefix(run_id, &format!("{parent_node_name}["))
            .map_err(|e| PyRuntimeError::new_err(e.to_string()))?;

        if !children.iter().all(|n| n.status.is_terminal()) {
            return Ok(None);
        }

        let any_failed = children
            .iter()
            .any(|n| n.status == WorkflowNodeStatus::Failed);
        let child_job_ids: Vec<String> = children.iter().filter_map(|n| n.job_id.clone()).collect();

        let now = now_millis();
        if any_failed {
            wf_storage
                .set_workflow_node_error(run_id, parent_node_name, "fan-out child failed")
                .map_err(|e| PyRuntimeError::new_err(e.to_string()))?;
        } else {
            wf_storage
                .set_workflow_node_completed(run_id, parent_node_name, now, None)
                .map_err(|e| PyRuntimeError::new_err(e.to_string()))?;
        }

        Ok(Some((!any_failed, child_job_ids)))
    }

    /// Check whether all workflow nodes are terminal and finalize the run.
    ///
    /// Called by the Python tracker after updating the fan-out parent status
    /// (e.g., after a failed fan-out). If all nodes are terminal, transitions
    /// the run to `Completed` or `Failed` and returns the final state string.
    /// Returns `None` if not all nodes are terminal yet.
    pub fn finalize_run_if_terminal(&self, run_id: &str) -> PyResult<Option<String>> {
        let wf_storage = workflow_storage(self)?;
        let nodes = wf_storage
            .get_workflow_nodes(run_id)
            .map_err(|e| PyRuntimeError::new_err(e.to_string()))?;

        if !nodes.iter().all(|n| n.status.is_terminal()) {
            return Ok(None);
        }

        let any_failed = nodes.iter().any(|n| n.status == WorkflowNodeStatus::Failed);
        let final_state = if any_failed {
            WorkflowState::Failed
        } else {
            WorkflowState::Completed
        };

        let now = now_millis();
        wf_storage
            .update_workflow_run_state(
                run_id,
                final_state,
                if final_state == WorkflowState::Failed {
                    Some("fan-out child failed")
                } else {
                    None
                },
            )
            .map_err(|e| PyRuntimeError::new_err(e.to_string()))?;
        wf_storage
            .set_workflow_run_completed(run_id, now)
            .map_err(|e| PyRuntimeError::new_err(e.to_string()))?;

        Ok(Some(final_state.as_str().to_string()))
    }

    /// Transition a workflow node to `WaitingApproval` status.
    ///
    /// Used by the Python tracker when a gate node becomes evaluable.
    /// Sets `started_at` without overriding the status (unlike
    /// `set_workflow_node_started` which forces `running`).
    pub fn set_workflow_node_waiting_approval(
        &self,
        run_id: &str,
        node_name: &str,
    ) -> PyResult<()> {
        let wf_storage = workflow_storage(self)?;
        wf_storage
            .update_workflow_node_status(run_id, node_name, WorkflowNodeStatus::WaitingApproval)
            .map_err(|e| PyRuntimeError::new_err(e.to_string()))?;
        Ok(())
    }

    /// Fetch node data from a prior run for incremental caching.
    ///
    /// Returns a list of ``(node_name, status, result_hash)`` tuples.
    pub fn get_base_run_node_data(
        &self,
        base_run_id: &str,
    ) -> PyResult<Vec<(String, String, Option<String>)>> {
        let wf_storage = workflow_storage(self)?;
        let nodes = wf_storage
            .get_workflow_nodes(base_run_id)
            .map_err(|e| PyRuntimeError::new_err(e.to_string()))?;
        Ok(nodes
            .into_iter()
            .map(|n| (n.node_name, n.status.as_str().to_string(), n.result_hash))
            .collect())
    }

    /// Return the DAG JSON bytes for a workflow run's definition.
    ///
    /// Used by the Python visualization layer to render diagrams.
    pub fn get_workflow_definition_dag(&self, run_id: &str) -> PyResult<Vec<u8>> {
        let wf_storage = workflow_storage(self)?;
        let run = wf_storage
            .get_workflow_run(run_id)
            .map_err(|e| PyRuntimeError::new_err(e.to_string()))?
            .ok_or_else(|| PyValueError::new_err(format!("run '{run_id}' not found")))?;
        let def = wf_storage
            .get_workflow_definition_by_id(&run.definition_id)
            .map_err(|e| PyRuntimeError::new_err(e.to_string()))?
            .ok_or_else(|| {
                PyRuntimeError::new_err(format!("definition '{}' not found", run.definition_id))
            })?;
        Ok(def.dag_data)
    }

    /// Set a node's fan_out_count and transition to Running.
    ///
    /// Also used by the tracker to mark sub-workflow parent nodes as Running.
    pub fn set_workflow_node_fan_out_count(
        &self,
        run_id: &str,
        node_name: &str,
        count: i32,
    ) -> PyResult<()> {
        let wf_storage = workflow_storage(self)?;
        wf_storage
            .set_workflow_node_fan_out_count(run_id, node_name, count)
            .map_err(|e| PyRuntimeError::new_err(e.to_string()))?;
        Ok(())
    }

    /// Approve or reject an approval gate node.
    ///
    /// Approved gates transition to `Completed`; rejected gates to `Failed`.
    #[pyo3(signature = (run_id, node_name, approved, error=None))]
    pub fn resolve_workflow_gate(
        &self,
        run_id: &str,
        node_name: &str,
        approved: bool,
        error: Option<String>,
    ) -> PyResult<()> {
        let wf_storage = workflow_storage(self)?;
        let now = now_millis();
        if approved {
            wf_storage
                .set_workflow_node_completed(run_id, node_name, now, None)
                .map_err(|e| PyRuntimeError::new_err(e.to_string()))?;
        } else {
            let err_msg = error.unwrap_or_else(|| "rejected".to_string());
            wf_storage
                .set_workflow_node_error(run_id, node_name, &err_msg)
                .map_err(|e| PyRuntimeError::new_err(e.to_string()))?;
        }
        Ok(())
    }

    /// Mark a single workflow node as `Skipped` and cancel its job.
    ///
    /// Used by the Python tracker for condition-based skip propagation.
    pub fn skip_workflow_node(&self, run_id: &str, node_name: &str) -> PyResult<()> {
        let wf_storage = workflow_storage(self)?;
        let node = wf_storage
            .get_workflow_node(run_id, node_name)
            .map_err(|e| PyRuntimeError::new_err(e.to_string()))?;
        if let Some(node) = node {
            if let Some(job_id) = &node.job_id {
                let _ = self.storage.cancel_job(job_id);
            }
            wf_storage
                .update_workflow_node_status(run_id, node_name, WorkflowNodeStatus::Skipped)
                .map_err(|e| PyRuntimeError::new_err(e.to_string()))?;
        }
        Ok(())
    }
}
