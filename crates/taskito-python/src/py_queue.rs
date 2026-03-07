// pyo3's #[pymethods] macro generates Into<PyErr> conversions that trigger this lint
#![allow(clippy::useless_conversion)]

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use pyo3::prelude::*;
use pyo3::types::PyDict;

use taskito_core::job::{now_millis, NewJob};
use taskito_core::periodic::next_cron_time;
use taskito_core::resilience::circuit_breaker::CircuitBreakerConfig;
use taskito_core::resilience::rate_limiter::RateLimitConfig;
use taskito_core::resilience::retry::RetryPolicy;
use taskito_core::scheduler::{Scheduler, SchedulerConfig, TaskConfig};
use taskito_core::storage::models::NewPeriodicTaskRow;
#[cfg(feature = "postgres")]
use taskito_core::storage::postgres::PostgresStorage;
#[cfg(feature = "redis")]
use taskito_core::storage::redis_backend::RedisStorage;
use taskito_core::storage::sqlite::SqliteStorage;
use taskito_core::storage::{Storage, StorageBackend};

use crate::py_config::PyTaskConfig;
use crate::py_job::PyJob;
use crate::py_worker::WorkerPool;

/// The core queue engine exposed to Python.
#[pyclass]
pub struct PyQueue {
    storage: StorageBackend,
    db_path: String,
    num_workers: usize,
    default_retry: i32,
    default_timeout: i64,
    default_priority: i32,
    shutdown_flag: Arc<AtomicBool>,
    result_ttl_ms: Option<i64>,
}

#[pymethods]
#[allow(
    clippy::too_many_arguments,
    clippy::useless_conversion,
    unused_variables
)]
impl PyQueue {
    #[new]
    #[pyo3(signature = (db_path=".taskito/taskito.db", workers=0, default_retry=3, default_timeout=300, default_priority=0, result_ttl=None, backend="sqlite", db_url=None, schema="taskito"))]
    pub fn new(
        db_path: &str,
        workers: usize,
        default_retry: i32,
        default_timeout: i64,
        default_priority: i32,
        result_ttl: Option<i64>,
        backend: &str,
        db_url: Option<&str>,
        schema: &str,
    ) -> PyResult<Self> {
        let storage = match backend {
            "sqlite" => {
                let s = SqliteStorage::new(db_path)
                    .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?;
                StorageBackend::Sqlite(s)
            }
            #[cfg(feature = "postgres")]
            "postgres" | "postgresql" => {
                let url = db_url.ok_or_else(|| {
                    pyo3::exceptions::PyValueError::new_err(
                        "db_url is required for postgres backend",
                    )
                })?;
                let s = PostgresStorage::with_schema(url, schema)
                    .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?;
                StorageBackend::Postgres(s)
            }
            #[cfg(feature = "redis")]
            "redis" => {
                let url = db_url.ok_or_else(|| {
                    pyo3::exceptions::PyValueError::new_err("db_url is required for redis backend")
                })?;
                let s = RedisStorage::new(url)
                    .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?;
                StorageBackend::Redis(s)
            }
            _ => {
                return Err(pyo3::exceptions::PyValueError::new_err(format!(
                    "Unknown backend: '{backend}'. Use 'sqlite', 'postgres', or 'redis'."
                )));
            }
        };

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
    #[pyo3(signature = (task_name, payload, queue="default", priority=None, delay_seconds=None, max_retries=None, timeout=None, unique_key=None, metadata=None, depends_on=None, expires=None, result_ttl=None))]
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
        expires: Option<f64>,
        result_ttl: Option<i64>,
    ) -> PyResult<PyJob> {
        let now = now_millis();
        let scheduled_at = match delay_seconds {
            Some(d) => {
                if !d.is_finite() || d < 0.0 {
                    return Err(pyo3::exceptions::PyValueError::new_err(
                        "delay_seconds must be a finite non-negative number",
                    ));
                }
                let delay_ms = (d * 1000.0) as i64;
                now.checked_add(delay_ms).ok_or_else(|| {
                    pyo3::exceptions::PyValueError::new_err(
                        "delay_seconds too large, would overflow",
                    )
                })?
            }
            None => now,
        };

        let expires_at = match expires {
            Some(e) => {
                if !e.is_finite() || e < 0.0 {
                    return Err(pyo3::exceptions::PyValueError::new_err(
                        "expires must be a finite non-negative number",
                    ));
                }
                let expires_ms = (e * 1000.0) as i64;
                Some(now.checked_add(expires_ms).ok_or_else(|| {
                    pyo3::exceptions::PyValueError::new_err("expires too large, would overflow")
                })?)
            }
            None => None,
        };
        let result_ttl_ms = match result_ttl {
            Some(s) => Some(s.checked_mul(1000).ok_or_else(|| {
                pyo3::exceptions::PyValueError::new_err("result_ttl too large, would overflow")
            })?),
            None => None,
        };

        let timeout_ms = timeout
            .unwrap_or(self.default_timeout)
            .checked_mul(1000)
            .ok_or_else(|| {
                pyo3::exceptions::PyValueError::new_err("timeout too large, would overflow")
            })?;

        let new_job = NewJob {
            queue: queue.to_string(),
            task_name: task_name.to_string(),
            payload,
            priority: priority.unwrap_or(self.default_priority),
            scheduled_at,
            max_retries: max_retries.unwrap_or(self.default_retry),
            timeout_ms,
            unique_key: unique_key.clone(),
            metadata,
            depends_on: depends_on.unwrap_or_default(),
            expires_at,
            result_ttl_ms,
            namespace: None,
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
                timeout_ms: {
                    let t = timeouts.as_ref().map_or(self.default_timeout, |t| {
                        t.get(i).copied().unwrap_or(self.default_timeout)
                    });
                    t.checked_mul(1000).ok_or_else(|| {
                        pyo3::exceptions::PyValueError::new_err("timeout too large, would overflow")
                    })?
                },
                unique_key: None,
                metadata: None,
                depends_on: vec![],
                expires_at: None,
                result_ttl_ms: None,
                namespace: None,
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
        if limit < 0 || offset < 0 {
            return Err(pyo3::exceptions::PyValueError::new_err(
                "limit and offset must be non-negative",
            ));
        }
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

    /// Request cancellation of a running job. Returns True if cancel was requested.
    pub fn request_cancel(&self, job_id: &str) -> PyResult<bool> {
        self.storage
            .request_cancel(job_id)
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))
    }

    /// Check if cancellation has been requested for a job.
    pub fn is_cancel_requested(&self, job_id: &str) -> PyResult<bool> {
        self.storage
            .is_cancel_requested(job_id)
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
        if !(0..=100).contains(&progress) {
            return Err(pyo3::exceptions::PyValueError::new_err(
                "progress must be between 0 and 100",
            ));
        }
        self.storage
            .update_progress(job_id, progress)
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))
    }

    /// Purge completed jobs older than given seconds ago. Returns count deleted.
    pub fn purge_completed(&self, older_than_seconds: i64) -> PyResult<u64> {
        let cutoff = now_millis().saturating_sub(older_than_seconds.saturating_mul(1000));
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
        if limit < 0 || offset < 0 {
            return Err(pyo3::exceptions::PyValueError::new_err(
                "limit and offset must be non-negative",
            ));
        }
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
        let cutoff = now_millis().saturating_sub(older_than_seconds.saturating_mul(1000));
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
    #[pyo3(signature = (name, task_name, cron_expr, args=None, kwargs=None, queue="default", timezone=None))]
    pub fn register_periodic(
        &self,
        name: &str,
        task_name: &str,
        cron_expr: &str,
        args: Option<Vec<u8>>,
        kwargs: Option<Vec<u8>>,
        queue: &str,
        timezone: Option<&str>,
    ) -> PyResult<()> {
        use taskito_core::periodic::next_cron_time_tz;

        let now = now_millis();
        let next_run = if let Some(tz) = timezone {
            next_cron_time_tz(cron_expr, now, tz)
        } else {
            next_cron_time(cron_expr, now)
        }
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
            timezone,
        };

        self.storage
            .register_periodic(&row)
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))
    }

    /// Pause a queue (no jobs will be dispatched from it).
    pub fn pause_queue(&self, queue_name: &str) -> PyResult<()> {
        self.storage
            .pause_queue(queue_name)
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))
    }

    /// Resume a paused queue.
    pub fn resume_queue(&self, queue_name: &str) -> PyResult<()> {
        self.storage
            .resume_queue(queue_name)
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))
    }

    /// List paused queues.
    pub fn list_paused_queues(&self) -> PyResult<Vec<String>> {
        self.storage
            .list_paused_queues()
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))
    }

    /// Cancel all pending jobs in a queue. Returns count cancelled.
    pub fn purge_queue(&self, queue_name: &str) -> PyResult<u64> {
        self.storage
            .cancel_pending_by_queue(queue_name)
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))
    }

    /// Cancel all pending jobs for a task name. Returns count cancelled.
    pub fn revoke_task(&self, task_name: &str) -> PyResult<u64> {
        self.storage
            .cancel_pending_by_task(task_name)
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))
    }

    /// Archive completed/dead/cancelled jobs older than cutoff (seconds ago).
    pub fn archive_old_jobs(&self, older_than_seconds: i64) -> PyResult<u64> {
        let cutoff = now_millis().saturating_sub(older_than_seconds.saturating_mul(1000));
        self.storage
            .archive_old_jobs(cutoff)
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))
    }

    /// List archived jobs with pagination.
    #[pyo3(signature = (limit=50, offset=0))]
    pub fn list_archived(&self, limit: i64, offset: i64) -> PyResult<Vec<PyJob>> {
        if limit < 0 || offset < 0 {
            return Err(pyo3::exceptions::PyValueError::new_err(
                "limit and offset must be non-negative",
            ));
        }
        let jobs = self
            .storage
            .list_archived(limit, offset)
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?;
        Ok(jobs.into_iter().map(PyJob::from).collect())
    }

    /// Run the worker loop. This blocks until interrupted.
    #[pyo3(signature = (task_registry, task_configs, queues=None, drain_timeout_secs=None, tags=None))]
    pub fn run_worker(
        &self,
        py: Python<'_>,
        task_registry: PyObject,
        task_configs: Vec<PyTaskConfig>,
        queues: Option<Vec<String>>,
        drain_timeout_secs: Option<u64>,
        tags: Option<String>,
    ) -> PyResult<()> {
        // Reset shutdown flag for this run
        self.shutdown_flag.store(false, Ordering::SeqCst);

        let queues = queues.unwrap_or_else(|| vec!["default".to_string()]);
        let queues_str = queues.join(",");

        let scheduler_config = SchedulerConfig {
            result_ttl_ms: self.result_ttl_ms,
            ..SchedulerConfig::default()
        };
        let mut scheduler = Scheduler::new(self.storage.clone(), queues, scheduler_config);

        // Build retry filters dict from the Queue's _task_retry_filters
        let retry_filters = py.eval_bound("{}", None, None)?;
        // Get the Queue's retry filters from the app module
        let app_queue_ref = {
            let context_mod = py.import_bound("taskito.context")?;
            context_mod.getattr("_queue_ref")?
        };
        if !app_queue_ref.is_none() {
            if let Ok(filters) = app_queue_ref.getattr("_task_retry_filters") {
                let filters_dict: &Bound<'_, PyDict> = filters.downcast()?;
                let out_dict: &Bound<'_, PyDict> = retry_filters.downcast()?;
                for (key, val) in filters_dict.iter() {
                    out_dict.set_item(key, val)?;
                }
            }
        }

        for tc in &task_configs {
            let custom_delays_ms = tc.retry_delays.as_ref().map(|delays| {
                delays
                    .iter()
                    .map(|d| {
                        if !d.is_finite() || *d < 0.0 {
                            0i64
                        } else {
                            (d * 1000.0) as i64
                        }
                    })
                    .collect()
            });
            let base_delay_ms = if !tc.retry_backoff.is_finite() || tc.retry_backoff < 0.0 {
                0i64
            } else {
                (tc.retry_backoff * 1000.0) as i64
            };
            let retry_policy = RetryPolicy {
                max_retries: tc.max_retries,
                base_delay_ms,
                max_delay_ms: 300_000,
                custom_delays_ms,
            };
            let rate_limit = tc
                .rate_limit
                .as_ref()
                .and_then(|s| RateLimitConfig::parse(s));
            let circuit_breaker =
                tc.circuit_breaker_threshold
                    .map(|threshold| CircuitBreakerConfig {
                        threshold,
                        window_ms: tc.circuit_breaker_window.unwrap_or(60) * 1000,
                        cooldown_ms: tc.circuit_breaker_cooldown.unwrap_or(300) * 1000,
                    });
            scheduler.register_task(
                tc.name.clone(),
                TaskConfig {
                    retry_policy,
                    rate_limit,
                    circuit_breaker,
                },
            );
        }

        let shutdown = scheduler.shutdown_handle();

        let (job_tx, job_rx) = crossbeam_channel::bounded(self.num_workers * 2);
        let (result_tx, result_rx) = crossbeam_channel::bounded(self.num_workers * 2);

        let registry_arc = Arc::new(task_registry);
        let filters_arc = Arc::new(retry_filters.into());
        let worker_pool = WorkerPool::start(
            self.num_workers,
            job_rx,
            result_tx,
            registry_arc,
            filters_arc,
        );

        let scheduler_arc = Arc::new(scheduler);
        let scheduler_for_dispatch = scheduler_arc.clone();

        // Generate a unique worker ID and register
        let worker_id = uuid::Uuid::now_v7().to_string();
        let _ = self
            .storage
            .register_worker(&worker_id, &queues_str, tags.as_deref());

        // Start heartbeat thread
        let heartbeat_storage = self.storage.clone();
        let heartbeat_worker_id = worker_id.clone();
        let heartbeat_flag = self.shutdown_flag.clone();
        let heartbeat_handle = std::thread::spawn(move || {
            while !heartbeat_flag.load(Ordering::SeqCst) {
                let _ = heartbeat_storage.heartbeat(&heartbeat_worker_id);
                let _ = heartbeat_storage.reap_dead_workers();
                std::thread::sleep(std::time::Duration::from_secs(5));
            }
        });

        let scheduler_handle = std::thread::spawn(move || {
            let rt = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(rt) => rt,
                Err(e) => {
                    eprintln!("taskito: failed to build tokio runtime: {e}");
                    return;
                }
            };
            rt.block_on(scheduler_for_dispatch.run(job_tx));
        });

        let scheduler_for_results = scheduler_arc.clone();
        let flag = self.shutdown_flag.clone();

        py.allow_threads(move || {
            let drain_timeout = std::time::Duration::from_secs(drain_timeout_secs.unwrap_or(30));

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
        let _ = heartbeat_handle.join();
        worker_pool.join();

        // Unregister worker on shutdown
        let _ = self.storage.unregister_worker(&worker_id);

        Ok(())
    }

    // ── Metrics API ────────────────────────────────────────────────

    /// Get raw metric records for a task (or all tasks).
    #[pyo3(signature = (task_name=None, since_seconds=3600))]
    pub fn get_metrics(
        &self,
        task_name: Option<&str>,
        since_seconds: i64,
    ) -> PyResult<Vec<PyObject>> {
        let since_ms = now_millis().saturating_sub(since_seconds.saturating_mul(1000));
        let rows = self
            .storage
            .get_metrics(task_name, since_ms)
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?;

        Python::with_gil(|py| {
            let mut result = Vec::with_capacity(rows.len());
            for r in rows {
                let dict = PyDict::new_bound(py);
                dict.set_item("id", r.id)?;
                dict.set_item("task_name", r.task_name)?;
                dict.set_item("job_id", r.job_id)?;
                dict.set_item("wall_time_ns", r.wall_time_ns)?;
                dict.set_item("memory_bytes", r.memory_bytes)?;
                dict.set_item("succeeded", r.succeeded)?;
                dict.set_item("recorded_at", r.recorded_at)?;
                result.push(dict.into());
            }
            Ok(result)
        })
    }

    // ── Replay API ───────────────────────────────────────────────

    /// Create a replay of an existing job (re-enqueue with same payload).
    pub fn replay_job(&self, job_id: &str) -> PyResult<String> {
        let original = self
            .storage
            .get_job(job_id)
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?
            .ok_or_else(|| {
                pyo3::exceptions::PyValueError::new_err(format!("Job not found: {job_id}"))
            })?;

        let new_job = NewJob {
            queue: original.queue,
            task_name: original.task_name,
            payload: original.payload,
            priority: original.priority,
            scheduled_at: now_millis(),
            max_retries: original.max_retries,
            timeout_ms: original.timeout_ms,
            unique_key: None,
            metadata: Some(format!("{{\"replayed_from\":\"{job_id}\"}}")),
            depends_on: vec![],
            expires_at: None,
            result_ttl_ms: original.result_ttl_ms,
            namespace: original.namespace,
        };

        let job = self
            .storage
            .enqueue(new_job)
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?;

        let _ = self.storage.record_replay(
            job_id,
            &job.id,
            original.result.as_deref(),
            None,
            original.error.as_deref(),
            None,
        );

        Ok(job.id)
    }

    /// Get replay history for a job.
    pub fn get_replay_history(&self, job_id: &str) -> PyResult<Vec<PyObject>> {
        let rows = self
            .storage
            .get_replay_history(job_id)
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?;

        Python::with_gil(|py| {
            let mut result = Vec::with_capacity(rows.len());
            for r in rows {
                let dict = PyDict::new_bound(py);
                dict.set_item("id", r.id)?;
                dict.set_item("original_job_id", r.original_job_id)?;
                dict.set_item("replay_job_id", r.replay_job_id)?;
                dict.set_item("replayed_at", r.replayed_at)?;
                dict.set_item("original_error", r.original_error)?;
                dict.set_item("replay_error", r.replay_error)?;
                result.push(dict.into());
            }
            Ok(result)
        })
    }

    // ── Task Logs API ────────────────────────────────────────────

    /// Write a structured log entry for a task.
    #[pyo3(signature = (job_id, task_name, level, message, extra=None))]
    pub fn write_task_log(
        &self,
        job_id: &str,
        task_name: &str,
        level: &str,
        message: &str,
        extra: Option<&str>,
    ) -> PyResult<()> {
        self.storage
            .write_task_log(job_id, task_name, level, message, extra)
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))
    }

    /// Get logs for a specific job.
    pub fn get_task_logs(&self, job_id: &str) -> PyResult<Vec<PyObject>> {
        let rows = self
            .storage
            .get_task_logs(job_id)
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?;

        Python::with_gil(|py| {
            let mut result = Vec::with_capacity(rows.len());
            for r in rows {
                let dict = PyDict::new_bound(py);
                dict.set_item("id", r.id)?;
                dict.set_item("job_id", r.job_id)?;
                dict.set_item("task_name", r.task_name)?;
                dict.set_item("level", r.level)?;
                dict.set_item("message", r.message)?;
                dict.set_item("extra", r.extra)?;
                dict.set_item("logged_at", r.logged_at)?;
                result.push(dict.into());
            }
            Ok(result)
        })
    }

    /// Query logs with filters.
    #[pyo3(signature = (task_name=None, level=None, since_seconds=3600, limit=100))]
    pub fn query_task_logs(
        &self,
        task_name: Option<&str>,
        level: Option<&str>,
        since_seconds: i64,
        limit: i64,
    ) -> PyResult<Vec<PyObject>> {
        if limit < 0 {
            return Err(pyo3::exceptions::PyValueError::new_err(
                "limit must be non-negative",
            ));
        }
        let since_ms = now_millis().saturating_sub(since_seconds.saturating_mul(1000));
        let rows = self
            .storage
            .query_task_logs(task_name, level, since_ms, limit)
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?;

        Python::with_gil(|py| {
            let mut result = Vec::with_capacity(rows.len());
            for r in rows {
                let dict = PyDict::new_bound(py);
                dict.set_item("id", r.id)?;
                dict.set_item("job_id", r.job_id)?;
                dict.set_item("task_name", r.task_name)?;
                dict.set_item("level", r.level)?;
                dict.set_item("message", r.message)?;
                dict.set_item("extra", r.extra)?;
                dict.set_item("logged_at", r.logged_at)?;
                result.push(dict.into());
            }
            Ok(result)
        })
    }

    // ── Circuit Breaker API ──────────────────────────────────────

    /// List all circuit breaker states.
    pub fn list_circuit_breakers(&self) -> PyResult<Vec<PyObject>> {
        let rows = self
            .storage
            .list_circuit_breakers()
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?;

        Python::with_gil(|py| {
            let mut result = Vec::with_capacity(rows.len());
            for r in rows {
                let dict = PyDict::new_bound(py);
                let state_str = match r.state {
                    1 => "open",
                    2 => "half_open",
                    _ => "closed",
                };
                dict.set_item("task_name", r.task_name)?;
                dict.set_item("state", state_str)?;
                dict.set_item("failure_count", r.failure_count)?;
                dict.set_item("last_failure_at", r.last_failure_at)?;
                dict.set_item("opened_at", r.opened_at)?;
                dict.set_item("threshold", r.threshold)?;
                dict.set_item("window_ms", r.window_ms)?;
                dict.set_item("cooldown_ms", r.cooldown_ms)?;
                result.push(dict.into());
            }
            Ok(result)
        })
    }

    // ── Worker API ───────────────────────────────────────────────

    /// List all registered workers.
    pub fn list_workers(&self) -> PyResult<Vec<PyObject>> {
        let rows = self
            .storage
            .list_workers()
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?;

        Python::with_gil(|py| {
            let mut result = Vec::with_capacity(rows.len());
            for r in rows {
                let dict = PyDict::new_bound(py);
                dict.set_item("worker_id", r.worker_id)?;
                dict.set_item("last_heartbeat", r.last_heartbeat)?;
                dict.set_item("queues", r.queues)?;
                dict.set_item("status", r.status)?;
                dict.set_item("tags", r.tags)?;
                result.push(dict.into());
            }
            Ok(result)
        })
    }

    pub fn __repr__(&self) -> String {
        format!(
            "PyQueue(db_path='{}', workers={})",
            self.db_path, self.num_workers
        )
    }
}
