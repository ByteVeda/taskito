use std::sync::atomic::Ordering;
use std::sync::Arc;

use pyo3::prelude::*;
use pyo3::types::PyDict;

use taskito_core::resilience::circuit_breaker::CircuitBreakerConfig;
use taskito_core::resilience::rate_limiter::RateLimitConfig;
use taskito_core::resilience::retry::RetryPolicy;
use taskito_core::scheduler::{JobResult, ResultOutcome, Scheduler, SchedulerConfig, TaskConfig};
use taskito_core::storage::Storage;

use super::PyQueue;
#[cfg(not(feature = "native-async"))]
use crate::async_worker::AsyncWorkerPool;
use crate::py_config::PyTaskConfig;

/// Mesh-aware scheduler bridge: receives jobs from the scheduler's
/// intermediate channel, pushes them into the local deque with affinity
/// sorting, then drains the deque to the real dispatcher channel.
#[cfg(feature = "mesh")]
async fn run_mesh_bridge(
    scheduler: Arc<taskito_core::scheduler::Scheduler>,
    mesh_node: Arc<taskito_mesh::MeshNode>,
    job_tx: tokio::sync::mpsc::Sender<taskito_core::job::Job>,
) {
    let (mesh_tx, mut mesh_rx) = tokio::sync::mpsc::channel::<taskito_core::job::Job>(64);

    let sched = scheduler.clone();
    let sched_task = tokio::spawn(async move {
        sched.run(mesh_tx).await;
    });

    loop {
        // Drain local deque to dispatcher first
        while let Some(job) = mesh_node.pop_local() {
            if job_tx.send(job).await.is_err() {
                let _ = sched_task.await;
                return;
            }
        }

        // Wait for scheduler to produce jobs
        match mesh_rx.recv().await {
            Some(job) => {
                let mut batch = vec![job];
                while let Ok(j) = mesh_rx.try_recv() {
                    batch.push(j);
                }
                mesh_node.prefetch(batch);
            }
            None => break,
        }
    }

    // Drain remaining deque
    while let Some(job) = mesh_node.pop_local() {
        if job_tx.send(job).await.is_err() {
            break;
        }
    }

    let _ = sched_task.await;
}

/// Dispatch a ResultOutcome to Python middleware hooks and events.
///
/// Called with the GIL held after `handle_result()` returns.
fn dispatch_outcome(py: Python<'_>, outcome: &ResultOutcome) {
    let result = (|| -> PyResult<()> {
        let context_mod = py.import_bound("taskito.context")?;
        let queue_ref = context_mod.getattr("_queue_ref")?;
        if queue_ref.is_none() {
            return Ok(());
        }

        match outcome {
            ResultOutcome::Retry {
                job_id,
                task_name,
                queue,
                error,
                retry_count,
                timed_out,
            } => {
                // Emit JOB_RETRYING event
                let events_mod = py.import_bound("taskito.events")?;
                let event_type = events_mod.getattr("EventType")?.getattr("JOB_RETRYING")?;
                let payload = PyDict::new_bound(py);
                payload.set_item("job_id", job_id)?;
                payload.set_item("task_name", task_name)?;
                payload.set_item("error", error)?;
                payload.set_item("retry_count", retry_count)?;
                queue_ref.call_method1("_emit_event", (event_type, payload))?;

                // Call on_timeout middleware if this was a timeout
                if *timed_out {
                    let ctx = build_lightweight_ctx(py, job_id, task_name, queue)?;
                    call_middleware_hook(py, &queue_ref, task_name, "on_timeout", (ctx,))?;
                }

                // Call on_retry middleware
                let ctx = build_lightweight_ctx(py, job_id, task_name, queue)?;
                let error_obj =
                    pyo3::exceptions::PyRuntimeError::new_err(error.clone()).into_py(py);
                call_middleware_hook(
                    py,
                    &queue_ref,
                    task_name,
                    "on_retry",
                    (ctx, error_obj, *retry_count),
                )?;
            }
            ResultOutcome::DeadLettered {
                job_id,
                task_name,
                queue,
                error,
                timed_out,
            } => {
                // Emit JOB_DEAD event
                let events_mod = py.import_bound("taskito.events")?;
                let event_type = events_mod.getattr("EventType")?.getattr("JOB_DEAD")?;
                let payload = PyDict::new_bound(py);
                payload.set_item("job_id", job_id)?;
                payload.set_item("task_name", task_name)?;
                payload.set_item("error", error)?;
                queue_ref.call_method1("_emit_event", (event_type, payload))?;

                // Call on_timeout middleware if this was a timeout
                if *timed_out {
                    let ctx = build_lightweight_ctx(py, job_id, task_name, queue)?;
                    call_middleware_hook(py, &queue_ref, task_name, "on_timeout", (ctx,))?;
                }

                // Call on_dead_letter middleware
                let ctx = build_lightweight_ctx(py, job_id, task_name, queue)?;
                let error_obj =
                    pyo3::exceptions::PyRuntimeError::new_err(error.clone()).into_py(py);
                call_middleware_hook(
                    py,
                    &queue_ref,
                    task_name,
                    "on_dead_letter",
                    (ctx, error_obj),
                )?;
            }
            ResultOutcome::Cancelled {
                job_id,
                task_name,
                queue,
            } => {
                // Emit JOB_CANCELLED event
                let events_mod = py.import_bound("taskito.events")?;
                let event_type = events_mod.getattr("EventType")?.getattr("JOB_CANCELLED")?;
                let payload = PyDict::new_bound(py);
                payload.set_item("job_id", job_id)?;
                payload.set_item("task_name", task_name)?;
                queue_ref.call_method1("_emit_event", (event_type, payload))?;

                // Call on_cancel middleware
                let ctx = build_lightweight_ctx(py, job_id, task_name, queue)?;
                call_middleware_hook(py, &queue_ref, task_name, "on_cancel", (ctx,))?;
            }
            ResultOutcome::Success { .. } => {
                // Success events are already emitted in _wrap_task
            }
        }
        Ok(())
    })();

    if let Err(e) = result {
        log::error!("[taskito] middleware dispatch error: {e}");
    }
}

/// Build a lightweight JobContext-like object for middleware hooks called
/// outside of task execution (retry/dlq/cancel outcomes).
fn build_lightweight_ctx<'py>(
    py: Python<'py>,
    job_id: &str,
    task_name: &str,
    queue_name: &str,
) -> PyResult<Bound<'py, pyo3::PyAny>> {
    let types_mod = py.import_bound("types")?;
    let ns = types_mod.call_method1("SimpleNamespace", ())?;
    ns.setattr("id", job_id)?;
    ns.setattr("task_name", task_name)?;
    ns.setattr("queue_name", queue_name)?;
    ns.setattr("retry_count", 0)?;
    Ok(ns)
}

/// Call a middleware hook on all middleware in the chain for a given task.
fn call_middleware_hook(
    py: Python<'_>,
    queue_ref: &Bound<'_, pyo3::PyAny>,
    task_name: &str,
    hook_name: &str,
    args: impl pyo3::IntoPy<pyo3::Py<pyo3::types::PyTuple>>,
) -> PyResult<()> {
    let chain = queue_ref.call_method1("_get_middleware_chain", (task_name,))?;
    let args_tuple = args.into_py(py);
    let args_bound = args_tuple.bind(py);
    for mw in chain.iter()? {
        let mw = mw?;
        if let Err(e) = mw.call_method(hook_name, args_bound, None) {
            let logging = py.import_bound("logging")?;
            let logger = logging.call_method1("getLogger", ("taskito",))?;
            logger.call_method1("warning", (format!("middleware {hook_name}() error: {e}"),))?;
        }
    }
    Ok(())
}

#[pymethods]
#[allow(clippy::useless_conversion)]
impl PyQueue {
    /// Run the worker loop. This blocks until interrupted.
    ///
    /// The heartbeat is now driven from Python (see `worker_heartbeat`),
    /// so the internal Rust heartbeat thread is removed.
    #[pyo3(signature = (
        task_registry,
        task_configs,
        queues=None,
        drain_timeout_secs=None,
        tags=None,
        worker_id=None,
        resources=None,
        threads=1,
        async_concurrency=100,
        queue_configs=None,
        pool=None,
        app_path=None,
        mesh_config=None,
    ))]
    #[allow(clippy::too_many_arguments)]
    pub fn run_worker(
        &self,
        py: Python<'_>,
        task_registry: PyObject,
        task_configs: Vec<PyTaskConfig>,
        queues: Option<Vec<String>>,
        drain_timeout_secs: Option<u64>,
        tags: Option<String>,
        worker_id: Option<String>,
        resources: Option<String>,
        threads: i32,
        #[allow(unused_variables)] async_concurrency: i32,
        queue_configs: Option<String>,
        pool: Option<String>,
        app_path: Option<String>,
        #[allow(unused_variables)] mesh_config: Option<String>,
    ) -> PyResult<()> {
        // Reset shutdown flag for this run
        self.shutdown_flag.store(false, Ordering::SeqCst);

        let queues = queues.unwrap_or_else(|| vec!["default".to_string()]);
        let queues_str = queues.join(",");

        let scheduler_config = SchedulerConfig {
            poll_interval: std::time::Duration::from_millis(self.scheduler_poll_interval_ms),
            reap_interval: self.scheduler_reap_interval,
            cleanup_interval: self.scheduler_cleanup_interval,
            result_ttl_ms: self.result_ttl_ms,
            batch_size: self.scheduler_batch_size,
            ..SchedulerConfig::default()
        };
        let mut scheduler = Scheduler::new(
            self.storage.clone(),
            queues,
            scheduler_config,
            self.namespace.clone(),
        );

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
            let max_delay_ms = tc
                .max_retry_delay
                .map(|s| s.saturating_mul(1000))
                .unwrap_or(300_000);
            let retry_policy = RetryPolicy {
                max_retries: tc.max_retries,
                base_delay_ms,
                max_delay_ms,
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
                        half_open_max_probes: tc.circuit_breaker_half_open_probes.unwrap_or(5),
                        half_open_success_rate: tc
                            .circuit_breaker_half_open_success_rate
                            .unwrap_or(0.8),
                    });
            scheduler.register_task(
                tc.name.clone(),
                TaskConfig {
                    retry_policy,
                    rate_limit,
                    circuit_breaker,
                    max_concurrent: tc.max_concurrent,
                },
            );
        }

        // Register queue-level rate limits and concurrency caps
        if let Some(ref qc_json) = queue_configs {
            if let Ok(map) = serde_json::from_str::<
                std::collections::HashMap<String, serde_json::Value>,
            >(qc_json)
            {
                for (queue_name, cfg) in map {
                    let rate_limit = cfg
                        .get("rate_limit")
                        .and_then(|v| v.as_str())
                        .and_then(RateLimitConfig::parse);
                    let max_concurrent = cfg
                        .get("max_concurrent")
                        .and_then(|v| v.as_i64())
                        .map(|v| v as i32);
                    scheduler.register_queue_config(
                        queue_name,
                        taskito_core::scheduler::QueueConfig {
                            rate_limit,
                            max_concurrent,
                        },
                    );
                }
            }
        }

        // Push-dispatch: install the in-process wake source the scheduler loop
        // consumes. SQLite wakes via a shared `Notify` and needs no runtime, so
        // it is installed here. Channel-based sources (Postgres/Redis) spawn a
        // listener and are installed inside the runtime below. When the feature
        // is off, `push_dispatch` is accepted but ignored so the default
        // constructor keeps polling.
        #[cfg(feature = "push-dispatch")]
        if self.push_dispatch {
            #[allow(irrefutable_let_patterns)]
            if let taskito_core::storage::StorageBackend::Sqlite(s) = &self.storage {
                scheduler.set_wake_source(taskito_core::scheduler::wake::WakeSource::InProcess(
                    s.notify_handle().clone(),
                ));
            }
        }
        #[cfg(not(feature = "push-dispatch"))]
        if self.push_dispatch {
            log::debug!(
                "push_dispatch=True but the crate was built without the \
                 'push-dispatch' feature; falling back to polling"
            );
        }

        let shutdown = scheduler.shutdown_handle();

        let (job_tx, job_rx) = tokio::sync::mpsc::channel(self.num_workers * 2);
        let (result_tx, result_rx) = crossbeam_channel::bounded(self.num_workers * 2);

        let registry_arc = Arc::new(task_registry);
        let filters_arc: Arc<PyObject> = Arc::new(retry_filters.into());

        let scheduler_arc = Arc::new(scheduler);
        let scheduler_for_dispatch = scheduler_arc.clone();

        // Generate or use the provided worker ID and register
        let worker_id = worker_id.unwrap_or_else(|| uuid::Uuid::now_v7().to_string());
        let hostname = gethostname::gethostname().to_string_lossy().to_string();
        let pid = std::process::id() as i32;
        let _ = self.storage.register_worker(
            &worker_id,
            &queues_str,
            tags.as_deref(),
            resources.as_deref(),
            None,
            threads,
            Some(&hostname),
            Some(pid),
            pool.as_deref(),
        );

        // Create the async executor for native async tasks (if feature enabled)
        #[cfg(feature = "native-async")]
        let async_executor = {
            let sender = taskito_async::PyResultSender::new(result_tx.clone());
            Python::with_gil(|py| -> PyResult<Arc<PyObject>> {
                let sender_obj = pyo3::Py::new(py, sender)?;
                let mod_ = py.import_bound("taskito.async_support.executor")?;
                let cls = mod_.getattr("AsyncTaskExecutor")?;
                let context_mod = py.import_bound("taskito.context")?;
                let queue_ref = context_mod.getattr("_queue_ref")?;
                let executor = cls.call1((
                    sender_obj,
                    registry_arc.clone_ref(py),
                    queue_ref,
                    async_concurrency,
                ))?;
                executor.call_method0("start")?;
                Ok(Arc::new(executor.into_py(py)))
            })?
        };

        // Build the dispatcher up front for the prefork case so we can install
        // it on the queue before the run loop starts — request_cancel relies on
        // the install to deliver out-of-band cancel signals to child processes.
        //
        // For in-process pools (native-async, classic async) `notify_cancel` is
        // a no-op — running tasks observe cancellation via the storage flag —
        // so we deliberately do NOT install the dispatcher on `self`.
        // Installing it would keep an `Arc<PyObject>` reference (the async
        // executor / PyResultSender chain) alive on the parent thread until
        // `set_dispatcher(None)` runs after `runtime_handle.join()`, deadlocking
        // shutdown: the drain loop waits for the result channel to disconnect,
        // which can't happen until PyResultSender drops, which can't happen
        // until both `async_executor` Arc refs drop — and the second ref is
        // exactly what `self.dispatcher` was holding.
        let num_workers = self.num_workers;
        let use_prefork = pool.as_deref() == Some("prefork");
        let dispatcher_for_run: Arc<dyn taskito_core::worker::WorkerDispatcher> = if use_prefork {
            let pool_arc: Arc<dyn taskito_core::worker::WorkerDispatcher> = Arc::new(
                crate::prefork::PreforkPool::new(num_workers, app_path.unwrap_or_default()),
            );
            self.set_dispatcher(Some(pool_arc.clone()));
            pool_arc
        } else {
            #[cfg(feature = "native-async")]
            {
                let pool_arc: Arc<dyn taskito_core::worker::WorkerDispatcher> =
                    Arc::new(taskito_async::NativeAsyncPool::new(
                        num_workers,
                        registry_arc.clone(),
                        filters_arc.clone(),
                        async_executor,
                    ));
                pool_arc
            }
            #[cfg(not(feature = "native-async"))]
            {
                let pool_arc: Arc<dyn taskito_core::worker::WorkerDispatcher> = Arc::new(
                    AsyncWorkerPool::new(num_workers, registry_arc.clone(), filters_arc.clone()),
                );
                pool_arc
            }
        };

        #[cfg(feature = "mesh")]
        let mesh_worker_id = worker_id.clone();

        // Captured for the channel-based (Postgres/Redis) wake-source setup
        // inside the runtime. Gated to the listener-bearing backends so the
        // default and SQLite-only builds have no unused binding.
        #[cfg(all(
            feature = "push-dispatch",
            any(feature = "postgres", feature = "redis")
        ))]
        let push_dispatch_enabled = self.push_dispatch;

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
                    log::error!("taskito: failed to build tokio runtime: {e}");
                    return;
                }
            };

            rt.block_on(async {
                // Channel-based wake sources (Postgres/Redis) must spawn their
                // listener inside the runtime. Installed here, before the
                // scheduler loop takes the source.
                #[cfg(feature = "push-dispatch")]
                {
                    match scheduler_for_dispatch.storage() {
                        #[cfg(feature = "postgres")]
                        taskito_core::storage::StorageBackend::Postgres(s)
                            if push_dispatch_enabled =>
                        {
                            let rx = taskito_core::storage::postgres::listener::spawn(s.clone());
                            scheduler_for_dispatch.set_wake_source(
                                taskito_core::scheduler::wake::WakeSource::Channel(rx),
                            );
                        }
                        #[cfg(feature = "redis")]
                        taskito_core::storage::StorageBackend::Redis(s)
                            if push_dispatch_enabled =>
                        {
                            let rx =
                                taskito_core::storage::redis_backend::listener::spawn(s.clone());
                            scheduler_for_dispatch.set_wake_source(
                                taskito_core::scheduler::wake::WakeSource::Channel(rx),
                            );
                        }
                        _ => {}
                    }
                }

                // When mesh is enabled, interpose a local deque between
                // scheduler and dispatcher for affinity-sorted prefetch.
                #[cfg(feature = "mesh")]
                let scheduler_task = {
                    if let Some(ref cfg_json) = mesh_config {
                        let mesh_cfg: taskito_mesh::MeshConfig =
                            serde_json::from_str(cfg_json).unwrap_or_default();
                        let mesh_node =
                            Arc::new(taskito_mesh::MeshNode::new(mesh_worker_id, mesh_cfg));
                        log::info!(
                            "[taskito] mesh scheduling enabled (local_buffer={})",
                            mesh_node.config().local_buffer_capacity,
                        );
                        tokio::spawn(async move {
                            run_mesh_bridge(scheduler_for_dispatch, mesh_node, job_tx).await;
                        })
                    } else {
                        tokio::spawn(async move {
                            scheduler_for_dispatch.run(job_tx).await;
                        })
                    }
                };
                #[cfg(not(feature = "mesh"))]
                let scheduler_task = tokio::spawn(async move {
                    scheduler_for_dispatch.run(job_tx).await;
                });

                let worker_task = tokio::spawn(async move {
                    dispatcher_for_run.run(job_rx, result_tx).await;
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
                                let outcome = py
                                    .allow_threads(|| scheduler_for_results.handle_result(result));
                                match outcome {
                                    Ok(ref o) => dispatch_outcome(py, o),
                                    Err(e) => {
                                        log::error!("[taskito] result handling error: {e}")
                                    }
                                }
                            }
                            PollAction::Continue => continue,
                            PollAction::Done => break,
                            PollAction::Shutdown => unreachable!(),
                        }
                    }
                    break;
                }
                PollAction::Result(result) => {
                    let outcome = py.allow_threads(|| scheduler_for_results.handle_result(result));
                    match outcome {
                        Ok(ref o) => dispatch_outcome(py, o),
                        Err(e) => log::error!("[taskito] result handling error: {e}"),
                    }
                }
                PollAction::Continue => continue,
                PollAction::Done => break,
            }
        }

        let _ = runtime_handle.join();

        // Clear the dispatcher reference so post-shutdown cancel requests
        // become no-ops instead of forwarding to a torn-down pool.
        self.set_dispatcher(None);

        // Unregister worker on shutdown
        let _ = self.storage.unregister_worker(&worker_id);

        Ok(())
    }

    /// Update the heartbeat for a running worker. Called from Python every 5s.
    /// Returns a list of worker IDs that were reaped as dead.
    #[pyo3(signature = (worker_id, resource_health=None))]
    pub fn worker_heartbeat(
        &self,
        worker_id: &str,
        resource_health: Option<&str>,
    ) -> PyResult<Vec<String>> {
        self.storage
            .heartbeat(worker_id, resource_health)
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?;
        let reaped = self.storage.reap_dead_workers().unwrap_or_default();
        Ok(reaped)
    }

    /// Update the status of a worker.
    pub fn set_worker_status(&self, worker_id: &str, status: &str) -> PyResult<()> {
        self.storage
            .update_worker_status(worker_id, status)
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))
    }
}
