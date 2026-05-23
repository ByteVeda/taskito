//! Workflow run lifecycle: submit, cancel, finalize-if-terminal.

use std::collections::{HashMap, HashSet};

use pyo3::exceptions::{PyRuntimeError, PyValueError};
use pyo3::prelude::*;

use taskito_core::error::Result as CoreResult;
use taskito_core::job::{now_millis, NewJob};
use taskito_core::storage::Storage;
use taskito_workflows::{
    topological_order, WorkflowNode, WorkflowNodeStatus, WorkflowRun, WorkflowState,
    WorkflowStorage,
};

use crate::py_queue::workflow_ops::{
    build_metadata_json, cascade_skip_pending_nodes, parse_step_metadata, workflow_storage,
};
use crate::py_queue::PyQueue;
use crate::py_workflow::PyWorkflowHandle;

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

        let deferred: HashSet<String> = deferred_node_names
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
                    compensation_job_id: None,
                    compensation_started_at: None,
                    compensation_completed_at: None,
                    compensation_error: None,
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
                    compensation_job_id: None,
                    compensation_started_at: None,
                    compensation_completed_at: None,
                    compensation_error: None,
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
                notes: None,
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
                compensation_job_id: None,
                compensation_started_at: None,
                compensation_completed_at: None,
                compensation_error: None,
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

    /// Override a run that finalized as `Failed` to `CompletedWithFailures`.
    ///
    /// Used by the Python tracker for `on_failure="continue"` runs that
    /// finished with a mix of completed and failed nodes when the workflow
    /// was constructed with `compensate_on_continue=True`. The Python
    /// tracker calls this after `mark_workflow_node_result` returns
    /// `Failed`, BEFORE handing off to the saga orchestrator.
    pub fn set_workflow_run_completed_with_failures(
        &self,
        py: Python<'_>,
        run_id: &str,
    ) -> PyResult<()> {
        let wf = workflow_storage(self)?;
        let rid = run_id.to_string();
        py.allow_threads(|| {
            wf.update_workflow_run_state(&rid, WorkflowState::CompletedWithFailures, None)
        })
        .map_err(|e| PyRuntimeError::new_err(e.to_string()))
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
}
