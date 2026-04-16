#![allow(clippy::useless_conversion)]
//! Python bindings for the `taskito-workflows` crate.
//!
//! Compiled only when the `workflows` feature is enabled. Exposes three
//! `#[pyclass]` types:
//!
//! * [`PyWorkflowBuilder`] — construct a DAG from Python and serialize it
//!   for storage.
//! * [`PyWorkflowHandle`] — opaque handle returned from `PyQueue::submit_workflow`
//!   carrying the run id.
//! * [`PyWorkflowRunStatus`] — snapshot of a workflow run, returned by
//!   `PyQueue::get_workflow_run_status`.

use std::collections::HashMap;

use pyo3::exceptions::{PyRuntimeError, PyValueError};
use pyo3::prelude::*;
use pyo3::types::PyDict;

use taskito_workflows::dagron_core::DAG;
use taskito_workflows::StepMetadata;

/// Builder for a workflow DAG.
///
/// Construct in Python, add steps, then call `serialize()` to produce
/// `(dag_json_bytes, step_metadata_json)` for submission.
#[pyclass]
pub struct PyWorkflowBuilder {
    dag: DAG<()>,
    step_metadata: HashMap<String, StepMetadata>,
    step_order: Vec<String>,
}

#[pymethods]
impl PyWorkflowBuilder {
    #[new]
    fn new() -> Self {
        Self {
            dag: DAG::new(),
            step_metadata: HashMap::new(),
            step_order: Vec::new(),
        }
    }

    /// Add a step to the workflow.
    ///
    /// `after` lists the names of predecessor steps that must complete before
    /// this step runs. All predecessors must already have been added.
    #[pyo3(signature = (
        name, task_name, after=None, queue=None, max_retries=None,
        timeout_ms=None, priority=None, args_template=None, kwargs_template=None,
        fan_out=None, fan_in=None, condition=None
    ))]
    #[allow(clippy::too_many_arguments)]
    fn add_step(
        &mut self,
        name: &str,
        task_name: &str,
        after: Option<Vec<String>>,
        queue: Option<String>,
        max_retries: Option<i32>,
        timeout_ms: Option<i64>,
        priority: Option<i32>,
        args_template: Option<String>,
        kwargs_template: Option<String>,
        fan_out: Option<String>,
        fan_in: Option<String>,
        condition: Option<String>,
    ) -> PyResult<()> {
        self.dag
            .add_node(name.to_string(), ())
            .map_err(|e| PyValueError::new_err(format!("add_node failed: {e}")))?;

        if let Some(preds) = after {
            for pred in preds {
                self.dag
                    .add_edge(&pred, name, None, None)
                    .map_err(|e| PyValueError::new_err(format!("add_edge failed: {e}")))?;
            }
        }

        self.step_metadata.insert(
            name.to_string(),
            StepMetadata {
                task_name: task_name.to_string(),
                queue,
                args_template,
                kwargs_template,
                max_retries,
                timeout_ms,
                priority,
                fan_out,
                fan_in,
                condition,
            },
        );
        self.step_order.push(name.to_string());
        Ok(())
    }

    /// Return the number of steps added.
    fn step_count(&self) -> usize {
        self.step_order.len()
    }

    /// Return the names of steps in insertion order.
    fn step_names(&self) -> Vec<String> {
        self.step_order.clone()
    }

    /// Serialize the DAG and its step metadata for storage.
    ///
    /// Returns `(dag_bytes, step_metadata_json)` where:
    ///   * `dag_bytes` is the UTF-8 encoded JSON of the dagron
    ///     `SerializableGraph` (no payloads).
    ///   * `step_metadata_json` is the JSON-encoded
    ///     `HashMap<String, StepMetadata>`.
    fn serialize(&self) -> PyResult<(Vec<u8>, String)> {
        let dag_json = self
            .dag
            .to_json(|_| None)
            .map_err(|e| PyRuntimeError::new_err(format!("DAG to_json failed: {e}")))?;
        let meta_json = serde_json::to_string(&self.step_metadata)
            .map_err(|e| PyRuntimeError::new_err(format!("step_metadata serialize failed: {e}")))?;
        Ok((dag_json.into_bytes(), meta_json))
    }
}

/// Opaque handle returned from `PyQueue::submit_workflow`.
#[pyclass]
#[derive(Clone)]
pub struct PyWorkflowHandle {
    #[pyo3(get)]
    pub run_id: String,
    #[pyo3(get)]
    pub name: String,
    #[pyo3(get)]
    pub definition_id: String,
}

#[pymethods]
impl PyWorkflowHandle {
    fn __repr__(&self) -> String {
        format!(
            "PyWorkflowHandle(run_id='{}', name='{}')",
            self.run_id, self.name
        )
    }
}

/// Snapshot of a workflow run's state and per-node status.
#[pyclass]
#[derive(Clone)]
pub struct PyWorkflowRunStatus {
    #[pyo3(get)]
    pub run_id: String,
    #[pyo3(get)]
    pub state: String,
    #[pyo3(get)]
    pub started_at: Option<i64>,
    #[pyo3(get)]
    pub completed_at: Option<i64>,
    #[pyo3(get)]
    pub error: Option<String>,
    pub nodes: Vec<(String, String, Option<String>, Option<String>)>,
}

#[pymethods]
impl PyWorkflowRunStatus {
    /// Return per-node status as a dict keyed by node name.
    ///
    /// Each value is a dict with keys `status`, `job_id`, and `error`.
    fn node_statuses<'py>(&self, py: Python<'py>) -> PyResult<Bound<'py, PyDict>> {
        let out = PyDict::new_bound(py);
        for (name, status, job_id, error) in &self.nodes {
            let entry = PyDict::new_bound(py);
            entry.set_item("status", status)?;
            entry.set_item("job_id", job_id.clone())?;
            entry.set_item("error", error.clone())?;
            out.set_item(name, entry)?;
        }
        Ok(out)
    }

    fn __repr__(&self) -> String {
        format!(
            "PyWorkflowRunStatus(run_id='{}', state='{}', nodes={})",
            self.run_id,
            self.state,
            self.nodes.len()
        )
    }
}
