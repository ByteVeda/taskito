use pyo3::prelude::*;

mod py_config;
mod py_job;
mod py_queue;
mod py_worker;

use py_config::PyTaskConfig;
use py_job::PyJob;
use py_queue::PyQueue;

#[pymodule]
fn _taskito(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_class::<PyQueue>()?;
    m.add_class::<PyJob>()?;
    m.add_class::<PyTaskConfig>()?;
    Ok(())
}
