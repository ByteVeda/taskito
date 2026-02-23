use pyo3::prelude::*;

/// Task configuration exposed to Python.
#[pyclass]
#[derive(Debug, Clone)]
pub struct PyTaskConfig {
    #[pyo3(get, set)]
    pub name: String,
    #[pyo3(get, set)]
    pub max_retries: i32,
    #[pyo3(get, set)]
    pub retry_backoff: f64,
    #[pyo3(get, set)]
    pub timeout: i64,
    #[pyo3(get, set)]
    pub priority: i32,
    #[pyo3(get, set)]
    pub rate_limit: Option<String>,
    #[pyo3(get, set)]
    pub queue: String,
}

#[pymethods]
impl PyTaskConfig {
    #[new]
    #[pyo3(signature = (name, max_retries=3, retry_backoff=1.0, timeout=300, priority=0, rate_limit=None, queue="default".to_string()))]
    pub fn new(
        name: String,
        max_retries: i32,
        retry_backoff: f64,
        timeout: i64,
        priority: i32,
        rate_limit: Option<String>,
        queue: String,
    ) -> Self {
        Self {
            name,
            max_retries,
            retry_backoff,
            timeout,
            priority,
            rate_limit,
            queue,
        }
    }
}
