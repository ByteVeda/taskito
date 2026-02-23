use std::sync::Arc;
use std::thread;

use crossbeam_channel::{Receiver, Sender};
use pyo3::prelude::*;
use pyo3::types::{PyBytes, PyDict, PyTuple};

use quickq_core::job::Job;
use quickq_core::scheduler::JobResult;

/// Manages a pool of std::threads that execute Python task functions.
/// Each thread acquires the GIL only when running a task, so the scheduler
/// and storage operations remain GIL-free.
pub struct WorkerPool {
    handles: Vec<thread::JoinHandle<()>>,
}

impl WorkerPool {
    /// Spawn `num_workers` threads that pull jobs from `job_rx`,
    /// execute them via the Python task registry, and send results to `result_tx`.
    pub fn start(
        num_workers: usize,
        job_rx: Receiver<Job>,
        result_tx: Sender<JobResult>,
        task_registry: Arc<PyObject>, // Python dict: {task_name: callable}
    ) -> Self {
        let mut handles = Vec::with_capacity(num_workers);

        for worker_id in 0..num_workers {
            let rx = job_rx.clone();
            let tx = result_tx.clone();
            let registry = task_registry.clone();

            let handle = thread::spawn(move || {
                worker_loop(worker_id, rx, tx, registry);
            });

            handles.push(handle);
        }

        Self { handles }
    }

    /// Wait for all worker threads to finish.
    pub fn join(self) {
        for handle in self.handles {
            let _ = handle.join();
        }
    }
}

fn worker_loop(
    _worker_id: usize,
    job_rx: Receiver<Job>,
    result_tx: Sender<JobResult>,
    task_registry: Arc<PyObject>,
) {
    while let Ok(job) = job_rx.recv() {
        let job_id = job.id.clone();
        let task_name = job.task_name.clone();
        let retry_count = job.retry_count;
        let max_retries = job.max_retries;

        let result = Python::with_gil(|py| -> PyResult<Option<Vec<u8>>> {
            execute_task(py, &task_registry, &job)
        });

        let job_result = match result {
            Ok(result_bytes) => JobResult::Success {
                job_id,
                result: result_bytes,
            },
            Err(e) => {
                let error_msg = Python::with_gil(|py| format_python_error(py, &e));
                JobResult::Failure {
                    job_id,
                    error: error_msg,
                    retry_count,
                    max_retries,
                    task_name,
                }
            }
        };

        if result_tx.send(job_result).is_err() {
            break; // Channel closed, shutting down
        }
    }
}

fn execute_task(
    py: Python<'_>,
    task_registry: &PyObject,
    job: &Job,
) -> PyResult<Option<Vec<u8>>> {
    let cloudpickle = py.import_bound("cloudpickle")?;
    let registry = task_registry.bind(py);

    // Look up the task function
    let registry_dict: &Bound<'_, PyDict> = registry.downcast()?;
    let task_fn = registry_dict
        .get_item(&job.task_name)?
        .ok_or_else(|| {
            pyo3::exceptions::PyKeyError::new_err(format!(
                "task '{}' not registered",
                job.task_name
            ))
        })?;

    // Set job context before execution
    let context_mod = py.import_bound("quickq.context")?;
    context_mod.call_method1(
        "_set_context",
        (&job.id, &job.task_name, job.retry_count, &job.queue),
    )?;

    // Deserialize arguments: (args, kwargs)
    let payload_bytes = PyBytes::new_bound(py, &job.payload);
    let unpickled = cloudpickle.call_method1("loads", (payload_bytes,))?;
    let args_tuple: Bound<'_, PyTuple> = unpickled.downcast_into()?;

    let args = args_tuple.get_item(0)?;
    let kwargs = args_tuple.get_item(1)?;

    // Call the task function
    let result = if kwargs.is_none() {
        let args_tuple_inner: Bound<'_, PyTuple> = args.downcast_into()?;
        task_fn.call(args_tuple_inner, None)
    } else {
        let kwargs_dict: Bound<'_, PyDict> = kwargs.downcast_into()?;
        let args_tuple_inner: Bound<'_, PyTuple> = args.downcast_into()?;
        task_fn.call(args_tuple_inner, Some(&kwargs_dict))
    };

    // Clear context after execution (whether success or failure)
    let _ = context_mod.call_method0("_clear_context");

    let result = result?;

    // Serialize result
    if result.is_none() {
        Ok(None)
    } else {
        let pickled = cloudpickle.call_method1("dumps", (result,))?;
        let bytes: Vec<u8> = pickled.extract()?;
        Ok(Some(bytes))
    }
}

fn format_python_error(py: Python<'_>, e: &PyErr) -> String {
    // Try to get a full traceback
    if let Ok(tb_mod) = py.import_bound("traceback") {
        if let Ok(formatted) = tb_mod.call_method1(
            "format_exception",
            (
                e.get_type_bound(py),
                e.value_bound(py),
                e.traceback_bound(py),
            ),
        ) {
            if let Ok(lines) = formatted.extract::<Vec<String>>() {
                return lines.join("");
            }
        }
    }
    format!("{e}")
}
