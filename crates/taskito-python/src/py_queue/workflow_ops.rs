//! Workflow operations on `PyQueue`.
//!
//! Compiled only when the `workflows` feature is enabled. Adds
//! workflow-specific methods to `PyQueue` via a separate `#[pymethods]`
//! impl block (enabled by pyo3's `multiple-pymethods` feature).

use std::collections::{HashMap, HashSet};

use pyo3::exceptions::{PyRuntimeError, PyValueError};
use pyo3::prelude::*;

use taskito_core::error::Result as CoreResult;
use taskito_core::job::{now_millis, NewJob};
use taskito_core::storage::{Storage, StorageBackend};
use taskito_workflows::{
    topological_order, StepMetadata, WorkflowNode, WorkflowNodeStatus, WorkflowRun,
    WorkflowSqliteStorage, WorkflowState, WorkflowStorage, WorkflowStorageBackend,
};

use crate::py_queue::PyQueue;
use crate::py_workflow::{PyWorkflowHandle, PyWorkflowRunStatus};

/// Return the queue's cached workflow storage, initializing it on first use.
///
/// Migrations run on first construction only; subsequent calls are a cheap
/// `OnceLock::get()`. Callers receive a cloned handle — every variant of
/// `WorkflowStorageBackend` wraps a pool handle so clones share the same
/// connection pool.
fn workflow_storage(queue: &PyQueue) -> PyResult<WorkflowStorageBackend> {
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

fn parse_step_metadata(json: &str) -> PyResult<HashMap<String, StepMetadata>> {
    serde_json::from_str(json)
        .map_err(|e| PyValueError::new_err(format!("invalid step_metadata JSON: {e}")))
}

/// Build a job-metadata JSON blob that carries workflow routing info.
///
/// Uses `serde_json` to guarantee proper escaping of node names containing
/// backslashes, control characters, or Unicode — hand-rolled escaping previously
/// produced invalid JSON for such inputs.
fn build_metadata_json(run_id: &str, node_name: &str) -> String {
    serde_json::json!({
        "workflow_run_id": run_id,
        "workflow_node_name": node_name,
    })
    .to_string()
}

fn status_to_py(status: WorkflowState) -> String {
    status.as_str().to_string()
}

/// Mark every pending/ready node in a run as skipped and cancel its job.
///
/// Best-effort: per-node failures are logged but do not abort the sweep.
fn cascade_skip_pending_nodes(
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
    pub fn get_workflow_run_status(
        &self,
        py: Python<'_>,
        run_id: &str,
    ) -> PyResult<PyWorkflowRunStatus> {
        let wf_storage = workflow_storage(self)?;
        let run_id_owned = run_id.to_string();

        let result: CoreResult<Option<PyWorkflowRunStatus>> = py.allow_threads(|| {
            let run = match wf_storage.get_workflow_run(&run_id_owned)? {
                Some(r) => r,
                None => return Ok(None),
            };
            let nodes = wf_storage.get_workflow_nodes(&run_id_owned)?;
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
            Ok(Some(PyWorkflowRunStatus {
                run_id: run.id,
                state: status_to_py(run.state),
                started_at: run.started_at,
                completed_at: run.completed_at,
                error: run.error,
                nodes: node_rows,
            }))
        });

        result
            .map_err(|e| PyRuntimeError::new_err(e.to_string()))?
            .ok_or_else(|| PyValueError::new_err(format!("workflow run '{run_id}' not found")))
    }

    /// Cancel a workflow run and all of its sub-workflow descendants.
    ///
    /// Marks each visited run `Cancelled`, skips pending/ready nodes, and
    /// cancels their underlying jobs. Traversal is iterative with a visited
    /// set so that any accidental cycle in `parent_run_id` links terminates
    /// safely instead of recursing. Nodes already running are left alone
    /// (consistent with taskito's existing cancel semantics).
    pub fn cancel_workflow_run(&self, py: Python<'_>, run_id: &str) -> PyResult<()> {
        let wf_storage = workflow_storage(self)?;
        let root = run_id.to_string();

        let result: CoreResult<()> = py.allow_threads(|| {
            let mut visited: HashSet<String> = HashSet::new();
            let mut stack: Vec<String> = vec![root];
            let now = now_millis();

            while let Some(rid) = stack.pop() {
                if !visited.insert(rid.clone()) {
                    continue;
                }

                let nodes = wf_storage.get_workflow_nodes(&rid)?;
                cascade_skip_pending_nodes(&self.storage, &wf_storage, &rid, &nodes)?;

                wf_storage.update_workflow_run_state(&rid, WorkflowState::Cancelled, None)?;
                wf_storage.set_workflow_run_completed(&rid, now)?;

                match wf_storage.get_child_workflow_runs(&rid) {
                    Ok(children) => {
                        for child in children {
                            if !child.state.is_terminal() && !visited.contains(&child.id) {
                                stack.push(child.id);
                            }
                        }
                    }
                    Err(e) => {
                        log::warn!(
                            "[taskito] get_child_workflow_runs({}) failed during cancel: {}",
                            rid,
                            e
                        );
                    }
                }
            }

            Ok(())
        });

        result.map_err(|e| PyRuntimeError::new_err(e.to_string()))
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
        py: Python<'_>,
        job_id: &str,
        succeeded: bool,
        error: Option<String>,
        skip_cascade: bool,
        result_hash: Option<String>,
    ) -> PyResult<Option<(String, String, Option<String>)>> {
        let wf_storage = workflow_storage(self)?;
        let job_id_owned = job_id.to_string();

        enum Outcome {
            NotFound,
            NoWorkflowMetadata,
            Settled {
                run_id: String,
                node_name: String,
                final_state: Option<String>,
            },
        }

        let outcome: CoreResult<Outcome> = py.allow_threads(|| {
            let job = match self.storage.get_job(&job_id_owned)? {
                Some(j) => j,
                None => return Ok(Outcome::NotFound),
            };

            let metadata_json = match &job.metadata {
                Some(m) => m,
                None => return Ok(Outcome::NoWorkflowMetadata),
            };
            let parsed: serde_json::Value = match serde_json::from_str(metadata_json) {
                Ok(v) => v,
                Err(_) => return Ok(Outcome::NoWorkflowMetadata),
            };
            let run_id = match parsed.get("workflow_run_id").and_then(|v| v.as_str()) {
                Some(id) => id.to_string(),
                None => return Ok(Outcome::NoWorkflowMetadata),
            };
            let node_name = match parsed.get("workflow_node_name").and_then(|v| v.as_str()) {
                Some(n) => n.to_string(),
                None => return Ok(Outcome::NoWorkflowMetadata),
            };

            let now = now_millis();
            if succeeded {
                wf_storage.set_workflow_node_completed(
                    &run_id,
                    &node_name,
                    now,
                    result_hash.as_deref(),
                )?;
            } else {
                let err_msg = error.clone().unwrap_or_else(|| "failed".to_string());
                wf_storage.set_workflow_node_error(&run_id, &node_name, &err_msg)?;
            }

            // Fail-fast: cascade failure to pending/ready nodes. Skipped when the
            // Python tracker manages cascade (conditions / continue mode).
            if !succeeded && !skip_cascade {
                let nodes = wf_storage.get_workflow_nodes(&run_id)?;
                cascade_skip_pending_nodes(&self.storage, &wf_storage, &run_id, &nodes)?;
            }

            // Note: fan-out parent status is NOT updated here. The tracker calls
            // `check_fan_out_completion` which uses a CAS to finalize exactly once.

            let nodes = wf_storage.get_workflow_nodes(&run_id)?;
            let all_terminal = nodes.iter().all(|n| n.status.is_terminal());
            if !all_terminal {
                return Ok(Outcome::Settled {
                    run_id,
                    node_name,
                    final_state: None,
                });
            }

            let any_failed = nodes.iter().any(|n| n.status == WorkflowNodeStatus::Failed);
            let final_state = if any_failed || !succeeded {
                WorkflowState::Failed
            } else {
                WorkflowState::Completed
            };

            wf_storage.update_workflow_run_state(
                &run_id,
                final_state,
                if final_state == WorkflowState::Failed {
                    error.as_deref()
                } else {
                    None
                },
            )?;
            wf_storage.set_workflow_run_completed(&run_id, now)?;

            Ok(Outcome::Settled {
                run_id,
                node_name,
                final_state: Some(final_state.as_str().to_string()),
            })
        });

        match outcome.map_err(|e| PyRuntimeError::new_err(e.to_string()))? {
            Outcome::NotFound => Err(PyValueError::new_err(format!("job '{job_id}' not found"))),
            Outcome::NoWorkflowMetadata => Ok(None),
            Outcome::Settled {
                run_id,
                node_name,
                final_state,
            } => Ok(Some((run_id, node_name, final_state))),
        }
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

            let mut child_job_ids = Vec::with_capacity(child_names.len());
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
                    depends_on: vec![],
                    expires_at: None,
                    result_ttl_ms: self.result_ttl_ms,
                    namespace: self.namespace.clone(),
                };
                let job = self.storage.enqueue(new_job)?;
                child_job_ids.push(job.id.clone());

                let wf_node = WorkflowNode {
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
                };
                wf_storage.create_workflow_node(&wf_node)?;
            }

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

    /// Check whether all workflow nodes are terminal and finalize the run.
    ///
    /// Called by the Python tracker after updating the fan-out parent status
    /// (e.g., after a failed fan-out). If all nodes are terminal, transitions
    /// the run to `Completed` or `Failed` and returns the final state string.
    /// Returns `None` if not all nodes are terminal yet.
    pub fn finalize_run_if_terminal(
        &self,
        py: Python<'_>,
        run_id: &str,
    ) -> PyResult<Option<String>> {
        let wf_storage = workflow_storage(self)?;
        let run_id_owned = run_id.to_string();

        let result: CoreResult<Option<String>> = py.allow_threads(|| {
            let nodes = wf_storage.get_workflow_nodes(&run_id_owned)?;
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
            wf_storage.update_workflow_run_state(
                &run_id_owned,
                final_state,
                if final_state == WorkflowState::Failed {
                    Some("fan-out child failed")
                } else {
                    None
                },
            )?;
            wf_storage.set_workflow_run_completed(&run_id_owned, now)?;
            Ok(Some(final_state.as_str().to_string()))
        });

        result.map_err(|e| PyRuntimeError::new_err(e.to_string()))
    }

    /// Transition a workflow node to `WaitingApproval` status.
    ///
    /// Used by the Python tracker when a gate node becomes evaluable.
    pub fn set_workflow_node_waiting_approval(
        &self,
        py: Python<'_>,
        run_id: &str,
        node_name: &str,
    ) -> PyResult<()> {
        let wf_storage = workflow_storage(self)?;
        let run_id_owned = run_id.to_string();
        let node_name_owned = node_name.to_string();

        py.allow_threads(|| {
            wf_storage.update_workflow_node_status(
                &run_id_owned,
                &node_name_owned,
                WorkflowNodeStatus::WaitingApproval,
            )
        })
        .map_err(|e| PyRuntimeError::new_err(e.to_string()))
    }

    /// Transition a workflow node to `Running` with a `started_at` timestamp.
    ///
    /// Used by the Python tracker to promote sub-workflow parent nodes after
    /// the child workflow has been successfully compiled and submitted. This
    /// is the clean counterpart to the old "waiting-approval → skip → running"
    /// dance that could leave nodes permanently skipped on compile failure.
    pub fn set_workflow_node_running(
        &self,
        py: Python<'_>,
        run_id: &str,
        node_name: &str,
    ) -> PyResult<()> {
        let wf_storage = workflow_storage(self)?;
        let run_id_owned = run_id.to_string();
        let node_name_owned = node_name.to_string();

        py.allow_threads(|| {
            wf_storage.set_workflow_node_running(&run_id_owned, &node_name_owned, now_millis())
        })
        .map_err(|e| PyRuntimeError::new_err(e.to_string()))
    }

    /// Fetch node data from a prior run for incremental caching.
    ///
    /// Returns a list of ``(node_name, status, result_hash)`` tuples.
    pub fn get_base_run_node_data(
        &self,
        py: Python<'_>,
        base_run_id: &str,
    ) -> PyResult<Vec<(String, String, Option<String>)>> {
        let wf_storage = workflow_storage(self)?;
        let base_run_id_owned = base_run_id.to_string();

        let result: CoreResult<Vec<(String, String, Option<String>)>> = py.allow_threads(|| {
            let nodes = wf_storage.get_workflow_nodes(&base_run_id_owned)?;
            Ok(nodes
                .into_iter()
                .map(|n| (n.node_name, n.status.as_str().to_string(), n.result_hash))
                .collect())
        });

        result.map_err(|e| PyRuntimeError::new_err(e.to_string()))
    }

    /// Return the DAG JSON bytes for a workflow run's definition.
    ///
    /// Used by the Python visualization layer to render diagrams.
    pub fn get_workflow_definition_dag(&self, py: Python<'_>, run_id: &str) -> PyResult<Vec<u8>> {
        let wf_storage = workflow_storage(self)?;
        let run_id_owned = run_id.to_string();

        enum Outcome {
            RunMissing,
            DefinitionMissing(String),
            Found(Vec<u8>),
        }

        let outcome: CoreResult<Outcome> = py.allow_threads(|| {
            let run = match wf_storage.get_workflow_run(&run_id_owned)? {
                Some(r) => r,
                None => return Ok(Outcome::RunMissing),
            };
            match wf_storage.get_workflow_definition_by_id(&run.definition_id)? {
                Some(def) => Ok(Outcome::Found(def.dag_data)),
                None => Ok(Outcome::DefinitionMissing(run.definition_id)),
            }
        });

        match outcome.map_err(|e| PyRuntimeError::new_err(e.to_string()))? {
            Outcome::Found(data) => Ok(data),
            Outcome::RunMissing => Err(PyValueError::new_err(format!("run '{run_id}' not found"))),
            Outcome::DefinitionMissing(def_id) => Err(PyRuntimeError::new_err(format!(
                "definition '{def_id}' not found"
            ))),
        }
    }

    /// Set a node's fan_out_count and transition to Running.
    pub fn set_workflow_node_fan_out_count(
        &self,
        py: Python<'_>,
        run_id: &str,
        node_name: &str,
        count: i32,
    ) -> PyResult<()> {
        let wf_storage = workflow_storage(self)?;
        let run_id_owned = run_id.to_string();
        let node_name_owned = node_name.to_string();

        py.allow_threads(|| {
            wf_storage.set_workflow_node_fan_out_count(&run_id_owned, &node_name_owned, count)
        })
        .map_err(|e| PyRuntimeError::new_err(e.to_string()))
    }

    /// Approve or reject an approval gate node.
    ///
    /// Approved gates transition to `Completed`; rejected gates to `Failed`.
    #[pyo3(signature = (run_id, node_name, approved, error=None))]
    pub fn resolve_workflow_gate(
        &self,
        py: Python<'_>,
        run_id: &str,
        node_name: &str,
        approved: bool,
        error: Option<String>,
    ) -> PyResult<()> {
        let wf_storage = workflow_storage(self)?;
        let run_id_owned = run_id.to_string();
        let node_name_owned = node_name.to_string();

        let result: CoreResult<()> = py.allow_threads(|| {
            let now = now_millis();
            if approved {
                wf_storage.set_workflow_node_completed(
                    &run_id_owned,
                    &node_name_owned,
                    now,
                    None,
                )?;
            } else {
                let err_msg = error.unwrap_or_else(|| "rejected".to_string());
                wf_storage.set_workflow_node_error(&run_id_owned, &node_name_owned, &err_msg)?;
            }
            Ok(())
        });

        result.map_err(|e| PyRuntimeError::new_err(e.to_string()))
    }

    /// Mark a workflow node as `Failed` with an error message.
    ///
    /// Used by the Python tracker when sub-workflow compilation or submission
    /// fails — the parent node needs a terminal state so the outer run can
    /// finalize instead of hanging.
    pub fn fail_workflow_node(
        &self,
        py: Python<'_>,
        run_id: &str,
        node_name: &str,
        error: &str,
    ) -> PyResult<()> {
        let wf_storage = workflow_storage(self)?;
        let run_id_owned = run_id.to_string();
        let node_name_owned = node_name.to_string();
        let error_owned = error.to_string();

        py.allow_threads(|| {
            wf_storage.set_workflow_node_error(&run_id_owned, &node_name_owned, &error_owned)
        })
        .map_err(|e| PyRuntimeError::new_err(e.to_string()))
    }

    /// Mark a single workflow node as `Skipped` and cancel its job.
    ///
    /// Used by the Python tracker for condition-based skip propagation.
    /// Cancel-job failures are logged but do not abort the skip — the node's
    /// terminal status is more important than best-effort job cancellation.
    pub fn skip_workflow_node(
        &self,
        py: Python<'_>,
        run_id: &str,
        node_name: &str,
    ) -> PyResult<()> {
        let wf_storage = workflow_storage(self)?;
        let run_id_owned = run_id.to_string();
        let node_name_owned = node_name.to_string();

        let result: CoreResult<()> = py.allow_threads(|| {
            let node = wf_storage.get_workflow_node(&run_id_owned, &node_name_owned)?;
            if let Some(node) = node {
                if let Some(job_id) = &node.job_id {
                    if let Err(e) = self.storage.cancel_job(job_id) {
                        log::warn!(
                            "[taskito] cancel_job({}) failed while skipping node '{}' in run {}: {}",
                            job_id,
                            node_name_owned,
                            run_id_owned,
                            e
                        );
                    }
                }
                wf_storage.update_workflow_node_status(
                    &run_id_owned,
                    &node_name_owned,
                    WorkflowNodeStatus::Skipped,
                )?;
            }
            Ok(())
        });

        result.map_err(|e| PyRuntimeError::new_err(e.to_string()))
    }
}
