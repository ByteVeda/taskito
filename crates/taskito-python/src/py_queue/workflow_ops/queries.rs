//! Read-only queries: run status, base run node data, definition DAG.

use pyo3::exceptions::{PyRuntimeError, PyValueError};
use pyo3::prelude::*;

use taskito_core::error::Result as CoreResult;
use taskito_workflows::WorkflowStorage;

use crate::py_queue::workflow_ops::{status_to_py, workflow_storage};
use crate::py_queue::PyQueue;
use crate::py_workflow::PyWorkflowRunStatus;

#[pymethods]
impl PyQueue {
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
}
