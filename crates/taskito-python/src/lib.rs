use pyo3::prelude::*;

#[cfg(not(feature = "native-async"))]
mod async_worker;
#[cfg(feature = "native-async")]
mod native_async;
mod prefork;
mod py_config;
mod py_job;
mod py_queue;
pub mod py_worker;
#[cfg(feature = "workflows")]
mod py_workflow;

use py_config::PyTaskConfig;
use py_job::PyJob;
use py_queue::PyQueue;

/// Activate the Rust → Python logging bridge.
///
/// Called explicitly from `taskito.log_config.configure()` rather than from
/// module init so that cold imports (which can run while a connection pool
/// is blocking the GIL on retries) don't trip pyo3-log's flush path.
#[pyfunction]
fn _init_rust_logging() {
    let _ = pyo3_log::try_init();
}

// `gil_used = true`: this extension relies on the GIL for its shared mutable
// state (scheduler, workflow tracker). Until that state is audited for the
// free-threaded build, advertise GIL dependence so 3.13t/3.14t fall back safely.
#[pymodule(gil_used = true)]
fn _taskito(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(_init_rust_logging, m)?)?;
    m.add_class::<PyQueue>()?;
    m.add_class::<PyJob>()?;
    m.add_class::<PyTaskConfig>()?;
    #[cfg(feature = "native-async")]
    m.add_class::<native_async::PyResultSender>()?;
    #[cfg(feature = "workflows")]
    {
        m.add_class::<py_workflow::PyWorkflowBuilder>()?;
        m.add_class::<py_workflow::PyWorkflowHandle>()?;
        m.add_class::<py_workflow::PyWorkflowRunStatus>()?;
        m.add_class::<py_workflow::PyWorkflowRun>()?;
        m.add_class::<py_workflow::PyWorkflowRunNode>()?;
    }
    Ok(())
}
