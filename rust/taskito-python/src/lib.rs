use pyo3::prelude::*;

mod py_queue;
mod py_job;
mod py_worker;
mod py_config;

use py_queue::PyQueue;
use py_job::PyJob;
use py_config::PyTaskConfig;

#[pymodule]
fn _taskito(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_class::<PyQueue>()?;
    m.add_class::<PyJob>()?;
    m.add_class::<PyTaskConfig>()?;
    Ok(())
}
