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
    #[pyo3(get, set)]
    pub circuit_breaker_threshold: Option<i32>,
    #[pyo3(get, set)]
    pub circuit_breaker_window: Option<i64>,
    #[pyo3(get, set)]
    pub circuit_breaker_cooldown: Option<i64>,
    #[pyo3(get, set)]
    pub retry_delays: Option<Vec<f64>>,
    #[pyo3(get, set)]
    pub max_retry_delay: Option<i64>,
    #[pyo3(get, set)]
    pub max_concurrent: Option<i32>,
}

#[pymethods]
#[allow(clippy::too_many_arguments)]
impl PyTaskConfig {
    #[new]
    #[pyo3(signature = (name, max_retries=3, retry_backoff=1.0, timeout=300, priority=0, rate_limit=None, queue="default".to_string(), circuit_breaker_threshold=None, circuit_breaker_window=None, circuit_breaker_cooldown=None, retry_delays=None, max_retry_delay=None, max_concurrent=None))]
    pub fn new(
        name: String,
        max_retries: i32,
        retry_backoff: f64,
        timeout: i64,
        priority: i32,
        rate_limit: Option<String>,
        queue: String,
        circuit_breaker_threshold: Option<i32>,
        circuit_breaker_window: Option<i64>,
        circuit_breaker_cooldown: Option<i64>,
        retry_delays: Option<Vec<f64>>,
        max_retry_delay: Option<i64>,
        max_concurrent: Option<i32>,
    ) -> Self {
        Self {
            name,
            max_retries,
            retry_backoff,
            timeout,
            priority,
            rate_limit,
            queue,
            circuit_breaker_threshold,
            circuit_breaker_window,
            circuit_breaker_cooldown,
            retry_delays,
            max_retry_delay,
            max_concurrent,
        }
    }
}
