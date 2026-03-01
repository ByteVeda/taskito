use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use crossbeam_channel;
use pyo3::prelude::*;
use pyo3::types::PyDict;

use taskito_core::job::{NewJob, now_millis};
use taskito_core::periodic::next_cron_time;
use taskito_core::rate_limiter::RateLimitConfig;
use taskito_core::retry::RetryPolicy;
use taskito_core::scheduler::{Scheduler, TaskConfig};
use taskito_core::storage::models::NewPeriodicTaskRow;
use taskito_core::storage::sqlite::SqliteStorage;

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
    shutdown_flag: Arc<AtomicBool>,
    result_ttl_ms: Option<i64>,
}

#[pymethods]
impl PyQueue {
    #[new]
    #[pyo3(signature = (db_path=".taskito/taskito.db", workers=0, default_retry=3, default_timeout=300, default_priority=0, result_ttl=None))]
    pub fn new(
        db_path: &str,
        workers: usize,
        default_retry: i32,
        default_timeout: i64,
        default_priority: i32,
        result_ttl: Option<i64>,
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
            shutdown_flag: Arc::new(AtomicBool::new(false)),
            result_ttl_ms: result_ttl.map(|s| s * 1000),
        })
    }

    /// Signal the worker to shut down gracefully.
    pub fn request_shutdown(&self) {
        self.shutdown_flag.store(true, Ordering::SeqCst);
    }

    /// Enqueue a job.
    #[pyo3(signature = (task_name, payload, queue="default", priority=None, delay_seconds=None, max_retries=None, timeout=None, unique_key=None, metadata=None, depends_on=None))]
    pub fn enqueue(
        &self,
        task_name: &str,
        payload: Vec<u8>,
        queue: &str,
        priority: Option<i32>,
        delay_seconds: Option<f64>,
        max_retries: Option<i32>,
        timeout: Option<i64>,
        unique_key: Option<String>,
        metadata: Option<String>,
        depends_on: Option<Vec<String>>,
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
            unique_key: unique_key.clone(),
            metadata,
            depends_on: depends_on.unwrap_or_default(),
        };

        let job = if unique_key.is_some() {
            self.storage.enqueue_unique(new_job)
        } else {
            self.storage.enqueue(new_job)
        };

        let job = job.map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?;
        Ok(PyJob::from(job))
    }

    /// Enqueue multiple jobs in a single transaction.
    #[pyo3(signature = (task_names, payloads, queues=None, priorities=None, max_retries_list=None, timeouts=None))]
    pub fn enqueue_batch(
        &self,
        task_names: Vec<String>,
        payloads: Vec<Vec<u8>>,
        queues: Option<Vec<String>>,
        priorities: Option<Vec<i32>>,
        max_retries_list: Option<Vec<i32>>,
        timeouts: Option<Vec<i64>>,
    ) -> PyResult<Vec<PyJob>> {
        let count = task_names.len();
        if payloads.len() != count {
            return Err(pyo3::exceptions::PyValueError::new_err(
                "task_names and payloads must have the same length",
            ));
        }

        let now = now_millis();
        let mut new_jobs = Vec::with_capacity(count);

        for i in 0..count {
            new_jobs.push(NewJob {
                queue: queues.as_ref().map_or("default".to_string(), |q| {
                    q.get(i).cloned().unwrap_or_else(|| "default".to_string())
                }),
                task_name: task_names[i].clone(),
                payload: payloads[i].clone(),
                priority: priorities.as_ref().map_or(self.default_priority, |p| {
                    p.get(i).copied().unwrap_or(self.default_priority)
                }),
                scheduled_at: now,
                max_retries: max_retries_list.as_ref().map_or(self.default_retry, |r| {
                    r.get(i).copied().unwrap_or(self.default_retry)
                }),
                timeout_ms: timeouts.as_ref().map_or(self.default_timeout * 1000, |t| {
                    t.get(i).copied().unwrap_or(self.default_timeout) * 1000
                }),
                unique_key: None,
                metadata: None,
                depends_on: vec![],
            });
        }

        let jobs = self
            .storage
            .enqueue_batch(new_jobs)
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?;

        Ok(jobs.into_iter().map(PyJob::from).collect())
    }

    /// List jobs with optional filters and pagination.
    #[pyo3(signature = (status=None, queue=None, task_name=None, limit=50, offset=0))]
    pub fn list_jobs(
        &self,
        status: Option<&str>,
        queue: Option<&str>,
        task_name: Option<&str>,
        limit: i64,
        offset: i64,
    ) -> PyResult<Vec<PyJob>> {
        let status_int = match status {
            Some(s) => Some(match s {
                "pending" => 0,
                "running" => 1,
                "complete" | "completed" => 2,
                "failed" => 3,
                "dead" => 4,
                "cancelled" => 5,
                _ => {
                    return Err(pyo3::exceptions::PyValueError::new_err(format!(
                        "Invalid status: {s}. Use: pending, running, complete, failed, dead, cancelled"
                    )))
                }
            }),
            None => None,
        };

        let jobs = self
            .storage
            .list_jobs(status_int, queue, task_name, limit, offset)
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?;

        Ok(jobs.into_iter().map(PyJob::from).collect())
    }

    /// Get a job by ID.
    pub fn get_job(&self, job_id: &str) -> PyResult<Option<PyJob>> {
        let job = self
            .storage
            .get_job(job_id)
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?;
        Ok(job.map(PyJob::from))
    }

    /// Cancel a pending job. Returns True if cancelled, False if not pending.
    pub fn cancel_job(&self, job_id: &str) -> PyResult<bool> {
        self.storage
            .cancel_job(job_id)
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))
    }

    /// Get the IDs of jobs that a given job depends on.
    pub fn get_dependencies(&self, job_id: &str) -> PyResult<Vec<String>> {
        self.storage
            .get_dependencies(job_id)
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))
    }

    /// Get the IDs of jobs that depend on a given job.
    pub fn get_dependents(&self, job_id: &str) -> PyResult<Vec<String>> {
        self.storage
            .get_dependents(job_id)
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))
    }

    /// Update progress for a running job (0-100).
    pub fn update_progress(&self, job_id: &str, progress: i32) -> PyResult<()> {
        self.storage
            .update_progress(job_id, progress)
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))
    }

    /// Purge completed jobs older than given seconds ago. Returns count deleted.
    pub fn purge_completed(&self, older_than_seconds: i64) -> PyResult<u64> {
        let cutoff = now_millis() - (older_than_seconds * 1000);
        self.storage
            .purge_completed(cutoff)
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))
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
            dict.set_item("cancelled", stats.cancelled)?;
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

    /// Get error history for a job.
    pub fn get_job_errors(&self, job_id: &str) -> PyResult<Vec<PyObject>> {
        let errors = self
            .storage
            .get_job_errors(job_id)
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?;

        Python::with_gil(|py| {
            let mut result = Vec::with_capacity(errors.len());
            for err in errors {
                let dict = PyDict::new_bound(py);
                dict.set_item("id", err.id)?;
                dict.set_item("job_id", err.job_id)?;
                dict.set_item("attempt", err.attempt)?;
                dict.set_item("error", err.error)?;
                dict.set_item("failed_at", err.failed_at)?;
                result.push(dict.into());
            }
            Ok(result)
        })
    }

    /// Register a periodic task schedule.
    #[pyo3(signature = (name, task_name, cron_expr, args=None, kwargs=None, queue="default"))]
    pub fn register_periodic(
        &self,
        name: &str,
        task_name: &str,
        cron_expr: &str,
        args: Option<Vec<u8>>,
        kwargs: Option<Vec<u8>>,
        queue: &str,
    ) -> PyResult<()> {
        let now = now_millis();
        let next_run = next_cron_time(cron_expr, now)
            .map_err(|e| pyo3::exceptions::PyValueError::new_err(e.to_string()))?;

        let row = NewPeriodicTaskRow {
            name,
            task_name,
            cron_expr,
            args: args.as_deref(),
            kwargs: kwargs.as_deref(),
            queue,
            enabled: true,
            next_run,
        };

        self.storage
            .register_periodic(&row)
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))
    }

    /// Run the worker loop. This blocks until interrupted.
    #[pyo3(signature = (task_registry, task_configs, queues=None))]
    pub fn run_worker(
        &self,
        py: Python<'_>,
        task_registry: PyObject,
        task_configs: Vec<PyTaskConfig>,
        queues: Option<Vec<String>>,
    ) -> PyResult<()> {
        // Reset shutdown flag for this run
        self.shutdown_flag.store(false, Ordering::SeqCst);

        let queues = queues.unwrap_or_else(|| vec!["default".to_string()]);

        let mut scheduler = Scheduler::new(self.storage.clone(), queues, self.result_ttl_ms);

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

        let (job_tx, job_rx) = crossbeam_channel::bounded(self.num_workers * 2);
        let (result_tx, result_rx) = crossbeam_channel::bounded(self.num_workers * 2);

        let registry_arc = Arc::new(task_registry);
        let worker_pool =
            WorkerPool::start(self.num_workers, job_rx, result_tx, registry_arc);

        let scheduler_arc = Arc::new(scheduler);
        let scheduler_for_dispatch = scheduler_arc.clone();

        let scheduler_handle = std::thread::spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("failed to build tokio runtime");
            rt.block_on(scheduler_for_dispatch.run(job_tx));
        });

        let scheduler_for_results = scheduler_arc.clone();
        let flag = self.shutdown_flag.clone();

        py.allow_threads(move || {
            let drain_timeout = std::time::Duration::from_secs(30);

            loop {
                // Check if graceful shutdown was requested
                if flag.load(Ordering::SeqCst) {
                    // Stop the scheduler from dispatching new jobs
                    shutdown.notify_one();

                    // Drain remaining results with a timeout
                    let drain_start = std::time::Instant::now();
                    while drain_start.elapsed() < drain_timeout {
                        match result_rx.recv_timeout(std::time::Duration::from_millis(100)) {
                            Ok(result) => {
                                if let Err(e) = scheduler_for_results.handle_result(result) {
                                    eprintln!("[taskito] result handling error: {e}");
                                }
                            }
                            Err(crossbeam_channel::RecvTimeoutError::Timeout) => {
                                // Check if all workers are done (channel disconnected)
                                continue;
                            }
                            Err(crossbeam_channel::RecvTimeoutError::Disconnected) => {
                                break;
                            }
                        }
                    }
                    break;
                }

                match result_rx.recv_timeout(std::time::Duration::from_millis(100)) {
                    Ok(result) => {
                        if let Err(e) = scheduler_for_results.handle_result(result) {
                            eprintln!("[taskito] result handling error: {e}");
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
