//! Node-level mutations: mark result, transition status, fail, skip.

use pyo3::exceptions::{PyRuntimeError, PyValueError};
use pyo3::prelude::*;

use taskito_core::error::Result as CoreResult;
use taskito_core::job::now_millis;
use taskito_core::storage::Storage;
use taskito_workflows::{WorkflowNodeStatus, WorkflowState, WorkflowStorage};

use crate::py_queue::workflow_ops::{cascade_skip_pending_nodes, workflow_storage};
use crate::py_queue::PyQueue;

#[pymethods]
impl PyQueue {
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
