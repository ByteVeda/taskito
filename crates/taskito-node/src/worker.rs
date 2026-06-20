//! Worker wiring — scheduler, dispatcher, result-drain, and worker lifecycle
//! (registration + heartbeat) so the worker shows up in the dashboard.

use std::sync::Arc;
use std::time::Duration;

use napi::bindgen_prelude::{spawn, spawn_blocking, Result};
use napi::threadsafe_function::{ErrorStrategy, ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;
use taskito_core::worker::WorkerDispatcher;
use taskito_core::{Scheduler, SchedulerConfig, Storage, StorageBackend};
use tokio::sync::Notify;

use crate::config::WorkerOptions;
use crate::convert::{outcome_to_js, JsOutcome, JsTaskInvocation};
use crate::dispatcher::NodeDispatcher;

const DEFAULT_QUEUE: &str = "default";
const DEFAULT_CHANNEL_CAPACITY: usize = 128;
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(5);

/// Handle to a running worker. Hold it for the worker's lifetime; call
/// [`JsWorker::stop`] to shut it down.
#[napi]
pub struct JsWorker {
    shutdown: Arc<Notify>,
    heartbeat_stop: Arc<Notify>,
}

#[napi]
impl JsWorker {
    /// Stop the worker: the scheduler stops dispatching, the heartbeat loop ends
    /// and unregisters, and the background tasks exit once in-flight results drain.
    #[napi]
    pub fn stop(&self) {
        // `notify_one` stores a permit if no waiter is parked yet, so the signal
        // is never lost between loop iterations.
        self.shutdown.notify_one();
        self.heartbeat_stop.notify_one();
    }
}

/// Start a worker over `storage` that runs `callback` for each dequeued job.
/// Fails fast if any task/queue config is invalid (e.g. a malformed rate limit).
pub fn start_worker(
    storage: StorageBackend,
    namespace: Option<String>,
    options: WorkerOptions,
    callback: ThreadsafeFunction<JsTaskInvocation, ErrorStrategy::Fatal>,
    outcome_callback: ThreadsafeFunction<JsOutcome, ErrorStrategy::Fatal>,
) -> Result<JsWorker> {
    let queues = options
        .queues
        .unwrap_or_else(|| vec![DEFAULT_QUEUE.to_string()]);
    // Clamp to >= 1: a zero-capacity Tokio/crossbeam channel panics on creation.
    let capacity = options
        .channel_capacity
        .map(|c| (c as usize).max(1))
        .unwrap_or(DEFAULT_CHANNEL_CAPACITY);

    let mut config = SchedulerConfig::default();
    if let Some(batch) = options.batch_size {
        config.batch_size = batch.max(1) as usize;
    }

    // The dispatcher reads cancel flags, and the lifecycle loop registers/heartbeats
    // — both need their own storage handle before `storage` moves into the scheduler.
    let dispatcher_storage = storage.clone();
    let lifecycle_storage = storage.clone();
    let queues_csv = queues.join(",");

    // Per-task/queue config must be registered before the scheduler is shared
    // (register_* take &mut self).
    let mut scheduler = Scheduler::new(storage, queues, config, namespace);
    for input in options.task_configs.iter().flatten() {
        scheduler.register_task(input.name.clone(), crate::convert::task_config(input)?);
    }
    for input in options.queue_configs.iter().flatten() {
        scheduler.register_queue_config(input.name.clone(), crate::convert::queue_config(input)?);
    }
    let scheduler = Arc::new(scheduler);
    let shutdown = scheduler.shutdown_handle();

    let (job_tx, job_rx) = tokio::sync::mpsc::channel(capacity);
    let (result_tx, result_rx) = crossbeam_channel::bounded(capacity);

    // Worker lifecycle: register, heartbeat every 5s, unregister on stop.
    let heartbeat_stop = Arc::new(Notify::new());
    spawn_worker_lifecycle(
        lifecycle_storage,
        queues_csv,
        capacity,
        heartbeat_stop.clone(),
    );

    // Scheduler loop: poll storage, dispatch ready jobs onto `job_tx`.
    let scheduler_run = scheduler.clone();
    spawn(async move {
        scheduler_run.run(job_tx).await;
    });

    // Dispatcher loop: execute each job in JS, report results on `result_tx`.
    let dispatcher = NodeDispatcher::new(callback, dispatcher_storage);
    spawn(async move {
        dispatcher.run(job_rx, result_tx).await;
    });

    // Result-drain loop: apply outcomes to storage. crossbeam `recv` is
    // blocking, so it runs on a blocking thread; it exits when every result
    // sender has dropped (i.e. after the dispatcher and all in-flight jobs end).
    let scheduler_results = scheduler;
    spawn_blocking(move || {
        while let Ok(result) = result_rx.recv() {
            match scheduler_results.handle_result(result) {
                // Surface each outcome to JS so the shell can emit events and run
                // middleware (the events layer).
                Ok(outcome) => {
                    outcome_callback.call(
                        outcome_to_js(&outcome),
                        ThreadsafeFunctionCallMode::NonBlocking,
                    );
                }
                Err(err) => log::error!("[taskito-node] result handling error: {err}"),
            }
        }
    });

    Ok(JsWorker {
        shutdown,
        heartbeat_stop,
    })
}

/// Register this worker and heartbeat until `stop` is signalled, then unregister.
fn spawn_worker_lifecycle(
    storage: StorageBackend,
    queues_csv: String,
    capacity: usize,
    stop: Arc<Notify>,
) {
    let worker_id = format!("node-{}", uuid::Uuid::now_v7());
    let hostname = gethostname::gethostname().to_string_lossy().to_string();
    let pid = std::process::id() as i32;
    let _ = storage.register_worker(
        &worker_id,
        &queues_csv,
        None,
        None,
        None,
        capacity as i32,
        Some(&hostname),
        Some(pid),
        Some("node"),
    );

    spawn(async move {
        loop {
            tokio::select! {
                _ = stop.notified() => break,
                _ = tokio::time::sleep(HEARTBEAT_INTERVAL) => {
                    let _ = storage.heartbeat(&worker_id, None);
                }
            }
        }
        let _ = storage.unregister_worker(&worker_id);
    });
}
