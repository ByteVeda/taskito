//! Worker wiring — spawns the scheduler, dispatcher, and result-drain loops.

use std::sync::Arc;

use napi::bindgen_prelude::{spawn, spawn_blocking};
use napi::threadsafe_function::{ErrorStrategy, ThreadsafeFunction};
use napi_derive::napi;
use taskito_core::worker::WorkerDispatcher;
use taskito_core::{Scheduler, SchedulerConfig, StorageBackend};
use tokio::sync::Notify;

use crate::config::WorkerOptions;
use crate::convert::JsTaskInvocation;
use crate::dispatcher::NodeDispatcher;

const DEFAULT_QUEUE: &str = "default";
const DEFAULT_CHANNEL_CAPACITY: usize = 128;

/// Handle to a running worker. Hold it for the worker's lifetime; call
/// [`JsWorker::stop`] to shut it down.
#[napi]
pub struct JsWorker {
    shutdown: Arc<Notify>,
}

#[napi]
impl JsWorker {
    /// Stop the worker: the scheduler stops dispatching new jobs and the
    /// background tasks exit once in-flight results drain.
    #[napi]
    pub fn stop(&self) {
        // `notify_one` stores a permit if no waiter is parked yet, so the signal
        // is never lost between scheduler poll iterations.
        self.shutdown.notify_one();
    }
}

/// Start a worker over `storage` that runs `callback` for each dequeued job.
pub fn start_worker(
    storage: StorageBackend,
    namespace: Option<String>,
    options: WorkerOptions,
    callback: ThreadsafeFunction<JsTaskInvocation, ErrorStrategy::Fatal>,
) -> JsWorker {
    let queues = options
        .queues
        .unwrap_or_else(|| vec![DEFAULT_QUEUE.to_string()]);
    let capacity = options
        .channel_capacity
        .map(|c| c as usize)
        .unwrap_or(DEFAULT_CHANNEL_CAPACITY);

    let mut config = SchedulerConfig::default();
    if let Some(batch) = options.batch_size {
        config.batch_size = batch.max(1) as usize;
    }

    // The dispatcher reads cancel flags directly, so it needs its own handle.
    let dispatcher_storage = storage.clone();

    // Per-task/queue config must be registered before the scheduler is shared
    // (register_* take &mut self).
    let mut scheduler = Scheduler::new(storage, queues, config, namespace);
    for input in options.task_configs.iter().flatten() {
        scheduler.register_task(input.name.clone(), crate::convert::task_config(input));
    }
    for input in options.queue_configs.iter().flatten() {
        scheduler.register_queue_config(input.name.clone(), crate::convert::queue_config(input));
    }
    let scheduler = Arc::new(scheduler);
    let shutdown = scheduler.shutdown_handle();

    let (job_tx, job_rx) = tokio::sync::mpsc::channel(capacity);
    let (result_tx, result_rx) = crossbeam_channel::bounded(capacity);

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
            if let Err(err) = scheduler_results.handle_result(result) {
                log::error!("[taskito-node] result handling error: {err}");
            }
        }
    });

    JsWorker { shutdown }
}
