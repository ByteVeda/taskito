use std::sync::Arc;

use crossbeam_channel;
use pyo3::prelude::*;
use pyo3::types::PyDict;

use quickq_core::job::{NewJob, now_millis};
use quickq_core::rate_limiter::RateLimitConfig;
use quickq_core::retry::RetryPolicy;
use quickq_core::scheduler::{Scheduler, TaskConfig};
use quickq_core::storage::sqlite::SqliteStorage;

use crate::py_config::PyTaskConfig;
use crate::py_job::PyJob;
use crate::py_worker::WorkerPool;

/// The core queue engine exposed to Python.
#[pyclass]
pub struct PyQueue {
    storage: SqliteStorage,
    db_path: String,
    num_workers: usize,
    default_retry: i32,
    default_timeout: i64,
    default_priority: i32,
}

#[pymethods]
impl PyQueue {
    #[new]
    #[pyo3(signature = (db_path="quickq.db", workers=0, default_retry=3, default_timeout=300, default_priority=0))]
    pub fn new(
        db_path: &str,
        workers: usize,
        default_retry: i32,
        default_timeout: i64,
        default_priority: i32,
    ) -> PyResult<Self> {
        let storage = SqliteStorage::new(db_path)
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?;

        let num_workers = if workers == 0 {
            std::thread::available_parallelism()
                .map(|n| n.get())
                .unwrap_or(4)
        } else {
            workers
        };

        Ok(Self {
            storage,
            db_path: db_path.to_string(),
            num_workers,
            default_retry,
            default_timeout,
            default_priority,
        })
    }

    /// Enqueue a job. Called from Python with the task name and pickled (args, kwargs).
    #[pyo3(signature = (task_name, payload, queue="default", priority=None, delay_seconds=None, max_retries=None, timeout=None))]
    pub fn enqueue(
        &self,
        task_name: &str,
        payload: Vec<u8>,
        queue: &str,
        priority: Option<i32>,
        delay_seconds: Option<f64>,
        max_retries: Option<i32>,
        timeout: Option<i64>,
    ) -> PyResult<PyJob> {
        let now = now_millis();
        let scheduled_at = match delay_seconds {
            Some(d) => now + (d * 1000.0) as i64,
            None => now,
        };

        let new_job = NewJob {
            queue: queue.to_string(),
            task_name: task_name.to_string(),
            payload,
            priority: priority.unwrap_or(self.default_priority),
            scheduled_at,
            max_retries: max_retries.unwrap_or(self.default_retry),
            timeout_ms: timeout.unwrap_or(self.default_timeout) * 1000,
        };

        let job = self
            .storage
            .enqueue(new_job)
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?;

        Ok(PyJob::from(job))
    }

    /// Get a job by ID.
    pub fn get_job(&self, job_id: &str) -> PyResult<Option<PyJob>> {
        let job = self
            .storage
            .get_job(job_id)
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?;
        Ok(job.map(PyJob::from))
    }

    /// Get queue statistics.
    pub fn stats(&self) -> PyResult<PyObject> {
        let stats = self
            .storage
            .stats()
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?;

        Python::with_gil(|py| {
            let dict = PyDict::new_bound(py);
            dict.set_item("pending", stats.pending)?;
            dict.set_item("running", stats.running)?;
            dict.set_item("completed", stats.completed)?;
            dict.set_item("failed", stats.failed)?;
            dict.set_item("dead", stats.dead)?;
            Ok(dict.into())
        })
    }

    /// List dead letter queue entries.
    #[pyo3(signature = (limit=10, offset=0))]
    pub fn dead_letters(&self, limit: i64, offset: i64) -> PyResult<Vec<PyObject>> {
        let dead = self
            .storage
            .list_dead(limit, offset)
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?;

        Python::with_gil(|py| {
            let mut result = Vec::with_capacity(dead.len());
            for d in dead {
                let dict = PyDict::new_bound(py);
                dict.set_item("id", d.id)?;
                dict.set_item("original_job_id", d.original_job_id)?;
                dict.set_item("queue", d.queue)?;
                dict.set_item("task_name", d.task_name)?;
                dict.set_item("error", d.error)?;
                dict.set_item("retry_count", d.retry_count)?;
                dict.set_item("failed_at", d.failed_at)?;
                dict.set_item("metadata", d.metadata)?;
                result.push(dict.into());
            }
            Ok(result)
        })
    }

    /// Re-enqueue a dead letter job. Returns new job ID.
    pub fn retry_dead(&self, dead_id: &str) -> PyResult<String> {
        self.storage
            .retry_dead(dead_id)
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))
    }

    /// Purge dead letter entries older than given seconds ago.
    pub fn purge_dead(&self, older_than_seconds: i64) -> PyResult<u64> {
        let cutoff = now_millis() - (older_than_seconds * 1000);
        self.storage
            .purge_dead(cutoff)
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))
    }

    /// Run the worker loop. This blocks until interrupted.
    /// `task_registry` is a Python dict mapping task_name -> callable.
    /// `task_configs` is a list of PyTaskConfig for retry/rate-limit settings.
    #[pyo3(signature = (task_registry, task_configs, queues=None))]
    pub fn run_worker(
        &self,
        py: Python<'_>,
        task_registry: PyObject,
        task_configs: Vec<PyTaskConfig>,
        queues: Option<Vec<String>>,
    ) -> PyResult<()> {
        let queues = queues.unwrap_or_else(|| vec!["default".to_string()]);

        // Build scheduler
        let mut scheduler = Scheduler::new(self.storage.clone(), queues);

        // Register task configs
        for tc in &task_configs {
            let retry_policy = RetryPolicy {
                max_retries: tc.max_retries,
                base_delay_ms: (tc.retry_backoff * 1000.0) as i64,
                max_delay_ms: 300_000,
            };
            let rate_limit = tc.rate_limit.as_ref().and_then(|s| RateLimitConfig::parse(s));
            scheduler.register_task(
                tc.name.clone(),
                TaskConfig {
                    retry_policy,
                    rate_limit,
                },
            );
        }

        let shutdown = scheduler.shutdown_handle();

        // Create channels
        let (job_tx, job_rx) = crossbeam_channel::bounded(self.num_workers * 2);
        let (result_tx, result_rx) = crossbeam_channel::bounded(self.num_workers * 2);

        // Start worker threads
        let registry_arc = Arc::new(task_registry);
        let worker_pool =
            WorkerPool::start(self.num_workers, job_rx, result_tx, registry_arc);

        // Run scheduler in a Tokio runtime on a separate thread
        let scheduler_arc = Arc::new(scheduler);
        let scheduler_for_dispatch = scheduler_arc.clone();

        let scheduler_handle = std::thread::spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("failed to build tokio runtime");
            rt.block_on(scheduler_for_dispatch.run(job_tx));
        });

        // Process results on the main thread (with GIL release)
        let scheduler_for_results = scheduler_arc.clone();

        // Release the GIL and process results
        py.allow_threads(move || {
            loop {
                match result_rx.recv_timeout(std::time::Duration::from_millis(100)) {
                    Ok(result) => {
                        if let Err(e) = scheduler_for_results.handle_result(result) {
                            eprintln!("[quickq] result handling error: {e}");
                        }
                    }
                    Err(crossbeam_channel::RecvTimeoutError::Timeout) => {
                        continue;
                    }
                    Err(crossbeam_channel::RecvTimeoutError::Disconnected) => {
                        break;
                    }
                }
            }
        });

        // Cleanup
        shutdown.notify_one();
        let _ = scheduler_handle.join();
        worker_pool.join();

        Ok(())
    }

    pub fn __repr__(&self) -> String {
        format!(
            "PyQueue(db_path='{}', workers={})",
            self.db_path, self.num_workers
        )
    }
}
