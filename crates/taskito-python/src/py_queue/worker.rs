use std::sync::atomic::Ordering;
use std::sync::Arc;

use pyo3::prelude::*;
use pyo3::types::PyDict;

use taskito_core::resilience::circuit_breaker::CircuitBreakerConfig;
use taskito_core::resilience::rate_limiter::RateLimitConfig;
use taskito_core::resilience::retry::RetryPolicy;
use taskito_core::scheduler::{JobResult, Scheduler, SchedulerConfig, TaskConfig};
use taskito_core::storage::Storage;

use super::PyQueue;
use crate::async_worker::AsyncWorkerPool;
use crate::py_config::PyTaskConfig;

#[pymethods]
#[allow(clippy::useless_conversion)]
impl PyQueue {
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
                            (d.min(i64::MAX as f64 / 1000.0) * 1000.0) as i64
                        }
                    })
                    .collect()
            });
            let base_delay_ms = if !tc.retry_backoff.is_finite() || tc.retry_backoff < 0.0 {
                0i64
            } else {
                (tc.retry_backoff.min(i64::MAX as f64 / 1000.0) * 1000.0) as i64
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

        let (job_tx, job_rx) = tokio::sync::mpsc::channel(self.num_workers * 2);
        let (result_tx, result_rx) = crossbeam_channel::bounded(self.num_workers * 2);

        let registry_arc = Arc::new(task_registry);
        let filters_arc = Arc::new(retry_filters.into());

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

        // Create multi-threaded tokio runtime for scheduler + async worker pool
        let num_workers = self.num_workers;
        // Move result_tx into the runtime — don't keep a copy in the main thread
        // so result_rx disconnects when all workers are done.
        let runtime_handle = std::thread::spawn(move || {
            let rt = match tokio::runtime::Builder::new_multi_thread()
                .worker_threads(2) // Scheduler + pool coordinator
                .enable_all()
                .build()
            {
                Ok(rt) => rt,
                Err(e) => {
                    eprintln!("taskito: failed to build tokio runtime: {e}");
                    return;
                }
            };

            rt.block_on(async {
                let pool = AsyncWorkerPool::new(num_workers, registry_arc, filters_arc);

                let scheduler_task = tokio::spawn(async move {
                    scheduler_for_dispatch.run(job_tx).await;
                });

                let worker_task = tokio::spawn(async move {
                    use taskito_core::worker::WorkerDispatcher;
                    pool.run(job_rx, result_tx).await;
                });

                let _ = tokio::join!(scheduler_task, worker_task);
            });
        });

        let scheduler_for_results = scheduler_arc.clone();
        let flag = self.shutdown_flag.clone();

        // Poll action enum for communicating between GIL-released and
        // GIL-held sections of the result loop.
        enum PollAction {
            Shutdown,
            Result(JobResult),
            Continue,
            Done,
        }

        let drain_timeout = std::time::Duration::from_secs(drain_timeout_secs.unwrap_or(30));

        loop {
            // Release GIL for one iteration of result polling
            let action = py.allow_threads(|| {
                if flag.load(Ordering::SeqCst) {
                    return PollAction::Shutdown;
                }
                match result_rx.recv_timeout(std::time::Duration::from_millis(100)) {
                    Ok(result) => PollAction::Result(result),
                    Err(crossbeam_channel::RecvTimeoutError::Timeout) => PollAction::Continue,
                    Err(crossbeam_channel::RecvTimeoutError::Disconnected) => PollAction::Done,
                }
            });

            // Re-acquire GIL briefly to let Python signal handlers run
            py.check_signals()?;

            match action {
                PollAction::Shutdown => {
                    // Stop the scheduler from dispatching new jobs
                    py.allow_threads(|| shutdown.notify_one());

                    // Drain remaining results with a timeout
                    let drain_start = std::time::Instant::now();
                    while drain_start.elapsed() < drain_timeout {
                        let drain_action = py.allow_threads(|| {
                            match result_rx.recv_timeout(std::time::Duration::from_millis(100)) {
                                Ok(result) => PollAction::Result(result),
                                Err(crossbeam_channel::RecvTimeoutError::Timeout) => {
                                    PollAction::Continue
                                }
                                Err(crossbeam_channel::RecvTimeoutError::Disconnected) => {
                                    PollAction::Done
                                }
                            }
                        });

                        // Allow signal handlers to run during drain too
                        py.check_signals()?;

                        match drain_action {
                            PollAction::Result(result) => {
                                py.allow_threads(|| {
                                    if let Err(e) = scheduler_for_results.handle_result(result) {
                                        eprintln!("[taskito] result handling error: {e}");
                                    }
                                });
                            }
                            PollAction::Continue => continue,
                            PollAction::Done => break,
                            PollAction::Shutdown => unreachable!(),
                        }
                    }
                    break;
                }
                PollAction::Result(result) => {
                    py.allow_threads(|| {
                        if let Err(e) = scheduler_for_results.handle_result(result) {
                            eprintln!("[taskito] result handling error: {e}");
                        }
                    });
                }
                PollAction::Continue => continue,
                PollAction::Done => break,
            }
        }

        let _ = runtime_handle.join();
        let _ = heartbeat_handle.join();

        // Unregister worker on shutdown
        let _ = self.storage.unregister_worker(&worker_id);

        Ok(())
    }
}
