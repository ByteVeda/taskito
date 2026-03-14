use crossbeam_channel::Sender;
use pyo3::prelude::*;
use pyo3::types::{PyBytes, PyDict, PyList, PyTuple};

use taskito_core::job::Job;
use taskito_core::scheduler::JobResult;

/// Execute a sync task on the current thread (called inside `spawn_blocking`).
///
/// Acquires the GIL, deserializes the payload via cloudpickle, calls the task
/// wrapper from the registry, serializes the result, and sends a `JobResult`
/// to the scheduler via `result_tx`.
pub fn execute_sync_task(
    task_registry: &PyObject,
    retry_filters: &PyObject,
    job: &Job,
    result_tx: &Sender<JobResult>,
) {
    let job_id = job.id.clone();
    let task_name = job.task_name.clone();
    let retry_count = job.retry_count;
    let max_retries = job.max_retries;

    let start = std::time::Instant::now();
    eprintln!("[taskito] Task {task_name}[{job_id}] received");

    let result =
        Python::with_gil(|py| -> PyResult<Option<Vec<u8>>> { run_task(py, task_registry, job) });

    let wall_time_ns: i64 = start.elapsed().as_nanos().try_into().unwrap_or(i64::MAX);

    let job_result = match result {
        Ok(result_bytes) => {
            let secs = start.elapsed().as_secs_f64();
            eprintln!("[taskito] Task {task_name}[{job_id}] succeeded in {secs:.3}s");
            JobResult::Success {
                job_id,
                result: result_bytes,
                task_name,
                wall_time_ns,
            }
        }
        Err(e) => {
            let (error_msg, is_cancelled, exc_class_name) = Python::with_gil(|py| {
                let msg = format_python_error(py, &e);
                let cancelled = is_cancelled_error(py, &e);
                let class_name = get_exception_class_name(py, &e);
                (msg, cancelled, class_name)
            });

            if is_cancelled {
                JobResult::Cancelled {
                    job_id,
                    task_name,
                    wall_time_ns,
                }
            } else {
                let should_retry = Python::with_gil(|py| {
                    check_should_retry(py, retry_filters, &task_name, &exc_class_name, &e)
                });

                eprintln!("[taskito] Task {task_name}[{job_id}] failed: {error_msg}");
                JobResult::Failure {
                    job_id,
                    error: error_msg,
                    retry_count,
                    max_retries,
                    task_name,
                    wall_time_ns,
                    should_retry,
                    timed_out: false,
                }
            }
        }
    };

    let _ = result_tx.send(job_result);
}

/// Inner task execution: deserialize payload, look up and call the task function,
/// serialize the return value.
fn run_task(py: Python<'_>, task_registry: &PyObject, job: &Job) -> PyResult<Option<Vec<u8>>> {
    let cloudpickle = py.import_bound("cloudpickle")?;
    let registry = task_registry.bind(py);

    let registry_dict: &Bound<'_, PyDict> = registry.downcast()?;
    let task_fn = registry_dict
        .get_item(&job.task_name)?
        .or_else(|| {
            if job.task_name.starts_with("__main__.") {
                let suffix = &job.task_name["__main__".len()..];
                registry_dict.iter().find_map(|(key, val)| {
                    let key_str = key.extract::<String>().ok()?;
                    if key_str.ends_with(suffix) {
                        Some(val)
                    } else {
                        None
                    }
                })
            } else {
                None
            }
        })
        .ok_or_else(|| {
            pyo3::exceptions::PyKeyError::new_err(format!(
                "task '{}' not registered",
                job.task_name
            ))
        })?;

    // Set job context before execution
    let context_mod = py.import_bound("taskito.context")?;
    context_mod.call_method1(
        "_set_context",
        (&job.id, &job.task_name, job.retry_count, &job.queue),
    )?;

    let result = (|| -> PyResult<Bound<'_, pyo3::PyAny>> {
        let payload_bytes = PyBytes::new_bound(py, &job.payload);
        let unpickled = cloudpickle.call_method1("loads", (payload_bytes,))?;
        let args_tuple: Bound<'_, PyTuple> = unpickled.downcast_into()?;

        if args_tuple.len() != 2 {
            return Err(pyo3::exceptions::PyValueError::new_err(format!(
                "expected payload to be a 2-tuple (args, kwargs), got {}-tuple",
                args_tuple.len()
            )));
        }

        let args = args_tuple.get_item(0)?;
        let kwargs = args_tuple.get_item(1)?;

        if kwargs.is_none() {
            let args_tuple_inner: Bound<'_, PyTuple> = args.downcast_into()?;
            task_fn.call(args_tuple_inner, None)
        } else {
            let kwargs_dict: Bound<'_, PyDict> = kwargs.downcast_into()?;
            let args_tuple_inner: Bound<'_, PyTuple> = args.downcast_into()?;
            task_fn.call(args_tuple_inner, Some(&kwargs_dict))
        }
    })();

    let _ = context_mod.call_method0("_clear_context");
    let result = result?;

    if result.is_none() {
        Ok(None)
    } else {
        let pickled = cloudpickle.call_method1("dumps", (result,))?;
        let bytes: Vec<u8> = pickled.extract()?;
        Ok(Some(bytes))
    }
}

fn format_python_error(py: Python<'_>, e: &PyErr) -> String {
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

fn is_cancelled_error(py: Python<'_>, e: &PyErr) -> bool {
    if let Ok(exceptions_mod) = py.import_bound("taskito.exceptions") {
        if let Ok(cancelled_cls) = exceptions_mod.getattr("TaskCancelledError") {
            return e
                .get_type_bound(py)
                .is_subclass(&cancelled_cls)
                .unwrap_or(false);
        }
    }
    false
}

fn get_exception_class_name(py: Python<'_>, e: &PyErr) -> String {
    let type_obj = e.get_type_bound(py);
    let module = type_obj
        .getattr("__module__")
        .and_then(|m| m.extract::<String>())
        .unwrap_or_default();
    let qualname = type_obj
        .getattr("__qualname__")
        .and_then(|q| q.extract::<String>())
        .unwrap_or_else(|_| "Exception".to_string());

    if module.is_empty() || module == "builtins" {
        qualname
    } else {
        format!("{module}.{qualname}")
    }
}

fn check_should_retry(
    py: Python<'_>,
    retry_filters: &PyObject,
    task_name: &str,
    _exc_class_name: &str,
    exc: &PyErr,
) -> bool {
    let filters = retry_filters.bind(py);
    let filters_dict: &Bound<'_, PyDict> = match filters.downcast() {
        Ok(d) => d,
        Err(_) => return true,
    };

    let task_filters = match filters_dict.get_item(task_name) {
        Ok(Some(f)) => f,
        _ => return true,
    };

    let task_dict: &Bound<'_, PyDict> = match task_filters.downcast() {
        Ok(d) => d,
        Err(_) => return true,
    };

    if let Ok(Some(dont_retry)) = task_dict.get_item("dont_retry_on") {
        if let Ok(list) = dont_retry.downcast::<PyList>() {
            for cls in list.iter() {
                if exc.get_type_bound(py).is_subclass(&cls).unwrap_or(false) {
                    return false;
                }
            }
        }
    }

    if let Ok(Some(retry_on)) = task_dict.get_item("retry_on") {
        if let Ok(list) = retry_on.downcast::<PyList>() {
            if !list.is_empty() {
                for cls in list.iter() {
                    if exc.get_type_bound(py).is_subclass(&cls).unwrap_or(false) {
                        return true;
                    }
                }
                return false;
            }
        }
    }

    true
}
