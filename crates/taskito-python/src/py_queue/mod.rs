// pyo3's #[pymethods] macro generates Into<PyErr> conversions that trigger this lint
#![allow(clippy::useless_conversion)]

mod inspection;
mod worker;
#[cfg(feature = "workflows")]
mod workflow_ops;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use pyo3::prelude::*;
use pyo3::types::PyDict;

use taskito_core::job::{now_millis, NewJob};
use taskito_core::periodic::next_cron_time;
use taskito_core::storage::models::NewPeriodicTaskRow;
#[cfg(feature = "postgres")]
use taskito_core::storage::postgres::PostgresStorage;
#[cfg(feature = "redis")]
use taskito_core::storage::redis_backend::RedisStorage;
use taskito_core::storage::sqlite::SqliteStorage;
use taskito_core::storage::{Storage, StorageBackend};

use crate::py_job::PyJob;

/// The core queue engine exposed to Python.
#[pyclass]
pub struct PyQueue {
    pub(crate) storage: StorageBackend,
    pub(crate) db_path: String,
    pub(crate) num_workers: usize,
    pub(crate) default_retry: i32,
    pub(crate) default_timeout: i64,
    pub(crate) default_priority: i32,
    pub(crate) shutdown_flag: Arc<AtomicBool>,
    pub(crate) result_ttl_ms: Option<i64>,
    pub(crate) scheduler_poll_interval_ms: u64,
    pub(crate) scheduler_reap_interval: u32,
    pub(crate) scheduler_cleanup_interval: u32,
    pub(crate) namespace: Option<String>,
}

#[pymethods]
#[allow(
    clippy::too_many_arguments,
    clippy::useless_conversion,
    unused_variables
)]
impl PyQueue {
    #[new]
    #[pyo3(signature = (db_path=".taskito/taskito.db", workers=0, default_retry=3, default_timeout=300, default_priority=0, result_ttl=None, backend="sqlite", db_url=None, schema="taskito", pool_size=None, scheduler_poll_interval_ms=50, scheduler_reap_interval=100, scheduler_cleanup_interval=1200, namespace=None))]
    #[allow(clippy::too_many_arguments)]
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
        pool_size: Option<u32>,
        scheduler_poll_interval_ms: u64,
        scheduler_reap_interval: u32,
        scheduler_cleanup_interval: u32,
        namespace: Option<String>,
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
                let s = PostgresStorage::with_schema_and_pool_size(
                    url,
                    schema,
                    pool_size.unwrap_or(10),
                )
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
                #[allow(unused_mut, clippy::useless_vec)]
                let mut available = vec!["sqlite"];
                #[cfg(feature = "postgres")]
                available.push("postgres");
                #[cfg(feature = "redis")]
                available.push("redis");
                return Err(pyo3::exceptions::PyValueError::new_err(format!(
                    "Unknown backend: '{backend}'. Available backends: {}.",
                    available.join(", ")
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
            scheduler_poll_interval_ms,
            scheduler_reap_interval,
            scheduler_cleanup_interval,
            namespace,
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
                if d > i64::MAX as f64 / 1000.0 {
                    return Err(pyo3::exceptions::PyValueError::new_err(
                        "delay_seconds too large",
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
                if e > i64::MAX as f64 / 1000.0 {
                    return Err(pyo3::exceptions::PyValueError::new_err("expires too large"));
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
            namespace: self.namespace.clone(),
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
    #[pyo3(signature = (task_names, payloads, queues=None, priorities=None, max_retries_list=None, timeouts=None, delay_seconds_list=None, unique_keys=None, metadata_list=None, expires_list=None, result_ttl_list=None))]
    #[allow(clippy::too_many_arguments)]
    pub fn enqueue_batch(
        &self,
        task_names: Vec<String>,
        payloads: Vec<Vec<u8>>,
        queues: Option<Vec<String>>,
        priorities: Option<Vec<i32>>,
        max_retries_list: Option<Vec<i32>>,
        timeouts: Option<Vec<i64>>,
        delay_seconds_list: Option<Vec<Option<f64>>>,
        unique_keys: Option<Vec<Option<String>>>,
        metadata_list: Option<Vec<Option<String>>>,
        expires_list: Option<Vec<Option<f64>>>,
        result_ttl_list: Option<Vec<Option<i64>>>,
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
            let delay = delay_seconds_list
                .as_ref()
                .and_then(|d| d.get(i).copied().flatten());
            let scheduled_at = match delay {
                Some(d) if d.is_finite() && d >= 0.0 => {
                    let delay_ms = (d * 1000.0) as i64;
                    now.saturating_add(delay_ms)
                }
                _ => now,
            };

            let expires_at = expires_list
                .as_ref()
                .and_then(|e| e.get(i).copied().flatten())
                .and_then(|e| {
                    if e.is_finite() && e >= 0.0 {
                        let ms = (e * 1000.0) as i64;
                        Some(now.saturating_add(ms))
                    } else {
                        None
                    }
                });

            let result_ttl_ms = result_ttl_list
                .as_ref()
                .and_then(|r| r.get(i).copied().flatten())
                .map(|s| s.saturating_mul(1000));

            new_jobs.push(NewJob {
                queue: queues.as_ref().map_or("default".to_string(), |q| {
                    q.get(i).cloned().unwrap_or_else(|| "default".to_string())
                }),
                task_name: task_names[i].clone(),
                payload: payloads[i].clone(),
                priority: priorities.as_ref().map_or(self.default_priority, |p| {
                    p.get(i).copied().unwrap_or(self.default_priority)
                }),
                scheduled_at,
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
                unique_key: unique_keys
                    .as_ref()
                    .and_then(|u| u.get(i).cloned().flatten()),
                metadata: metadata_list
                    .as_ref()
                    .and_then(|m| m.get(i).cloned().flatten()),
                depends_on: vec![],
                expires_at,
                result_ttl_ms,
                namespace: self.namespace.clone(),
            });
        }

        let jobs = self
            .storage
            .enqueue_batch(new_jobs)
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

    /// Get queue statistics for a specific queue.
    pub fn stats_by_queue(&self, queue_name: &str) -> PyResult<PyObject> {
        let stats = self
            .storage
            .stats_by_queue(queue_name)
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

    /// Get queue statistics broken down by queue name.
    pub fn stats_all_queues(&self) -> PyResult<PyObject> {
        let all = self
            .storage
            .stats_all_queues()
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?;

        Python::with_gil(|py| {
            let outer = PyDict::new_bound(py);
            for (queue, stats) in all {
                let dict = PyDict::new_bound(py);
                dict.set_item("pending", stats.pending)?;
                dict.set_item("running", stats.running)?;
                dict.set_item("completed", stats.completed)?;
                dict.set_item("failed", stats.failed)?;
                dict.set_item("dead", stats.dead)?;
                dict.set_item("cancelled", stats.cancelled)?;
                outer.set_item(queue, dict)?;
            }
            Ok(outer.into())
        })
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

    pub fn __repr__(&self) -> String {
        format!(
            "PyQueue(db_path='{}', workers={})",
            self.db_path, self.num_workers
        )
    }
}
