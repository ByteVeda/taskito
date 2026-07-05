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
#[cfg(feature = "mesh")]
use crate::error::invalid_arg;

const DEFAULT_QUEUE: &str = "default";
const DEFAULT_CHANNEL_CAPACITY: usize = 128;
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(5);

/// Handle to a running worker. Hold it for the worker's lifetime; call
/// [`JsWorker::stop`] to shut it down.
#[napi]
pub struct JsWorker {
    shutdown: Arc<Notify>,
    heartbeat_stop: Arc<Notify>,
    #[cfg(feature = "mesh")]
    mesh_shutdown: Arc<Notify>,
}

#[napi]
impl JsWorker {
    /// Stop the worker: the scheduler stops dispatching, the heartbeat loop ends
    /// and unregisters, mesh gossip/steal tasks shut down, and the background
    /// tasks exit once in-flight results drain.
    #[napi]
    pub fn stop(&self) {
        // `notify_one` stores a permit if no waiter is parked yet, so the signal
        // is never lost between loop iterations.
        self.shutdown.notify_one();
        self.heartbeat_stop.notify_one();
        #[cfg(feature = "mesh")]
        self.mesh_shutdown.notify_one();
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
    // Validate the mesh port up front: the steal server binds `port + 1`, and
    // both narrow to u16, so anything outside 1..=65534 wraps to a wrong port.
    #[cfg(feature = "mesh")]
    if let Some(mesh_cfg) = options.mesh.as_ref() {
        if mesh_cfg.port < 1 || mesh_cfg.port > 65534 {
            return Err(invalid_arg(format!(
                "mesh port must be in 1..=65534 (got {})",
                mesh_cfg.port
            )));
        }
    }
    #[cfg(feature = "mesh")]
    let mesh_shutdown = Arc::new(Notify::new());
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
    let worker_id = format!("node-{}", uuid::Uuid::now_v7());
    // Mesh gossip advertises the served queues; capture them before `queues`
    // moves into the scheduler.
    #[cfg(feature = "mesh")]
    let mesh_queues = queues.clone();

    // Per-task/queue config must be registered before the scheduler is shared
    // (register_* take &mut self).
    let mut scheduler = Scheduler::new(storage, queues, config, namespace);
    // Claim execution under this worker's id so dead-worker recovery can
    // attribute orphaned jobs (matches the register_worker id below).
    scheduler.set_claim_owner(worker_id.clone());
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
        worker_id.clone(),
        queues_csv,
        capacity,
        heartbeat_stop.clone(),
    );

    // Scheduler loop: poll storage, dispatch ready jobs onto `job_tx`. With the
    // mesh feature built and a mesh config supplied, route the scheduler's output
    // through the mesh bridge (affinity-sorted local deque + work-stealing); the
    // DB stays the source of truth, so the plain path is otherwise identical.
    #[cfg(feature = "mesh")]
    {
        if let Some(mesh_cfg) = options.mesh.as_ref() {
            let mesh_node = Arc::new(taskito_mesh::MeshNode::new(
                worker_id.clone(),
                build_mesh_config(mesh_cfg),
            ));
            let gossip = mesh_node.spawn_gossip(mesh_queues, capacity as u16);
            let steal_server = mesh_node.spawn_steal_server();
            let bridge_scheduler = scheduler.clone();
            let bridge_node = mesh_node.clone();
            spawn(async move {
                run_mesh_bridge(bridge_scheduler, bridge_node, job_tx).await;
            });
            // On stop, signal the mesh node so gossip + steal-server tasks exit
            // instead of leaking for the process lifetime.
            let mesh_stop = mesh_shutdown.clone();
            let stop_node = mesh_node.clone();
            spawn(async move {
                mesh_stop.notified().await;
                stop_node.request_shutdown();
            });
            // Keep the gossip + steal-server tasks alive for the worker's lifetime.
            spawn(async move {
                let _ = tokio::join!(gossip, steal_server);
            });
        } else {
            let scheduler_run = scheduler.clone();
            spawn(async move {
                scheduler_run.run(job_tx).await;
            });
        }
    }
    #[cfg(not(feature = "mesh"))]
    {
        let scheduler_run = scheduler.clone();
        spawn(async move {
            scheduler_run.run(job_tx).await;
        });
    }

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
            // A panicking result must not kill the drain loop — a dead loop
            // silently drops every later outcome.
            let handled = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                scheduler_results.handle_result(result)
            }));
            match handled {
                // Surface each outcome to JS so the shell can emit events and run
                // middleware (the events layer).
                Ok(Ok(outcome)) => {
                    outcome_callback.call(
                        outcome_to_js(&outcome),
                        ThreadsafeFunctionCallMode::NonBlocking,
                    );
                }
                Ok(Err(err)) => log::error!("[taskito-node] result handling error: {err}"),
                Err(_) => log::error!("[taskito-node] result handling panicked; outcome dropped"),
            }
        }
    });

    Ok(JsWorker {
        shutdown,
        heartbeat_stop,
        #[cfg(feature = "mesh")]
        mesh_shutdown,
    })
}

/// Register this worker and heartbeat until `stop` is signalled, then unregister.
fn spawn_worker_lifecycle(
    storage: StorageBackend,
    worker_id: String,
    queues_csv: String,
    capacity: usize,
    stop: Arc<Notify>,
) {
    let hostname = gethostname::gethostname().to_string_lossy().to_string();
    let pid = std::process::id() as i32;
    // Log lifecycle failures: a worker that can't register/heartbeat goes
    // invisible or stale in the dashboard, and a silent error hides that.
    if let Err(err) = storage.register_worker(
        &worker_id,
        &queues_csv,
        None,
        None,
        None,
        capacity as i32,
        Some(&hostname),
        Some(pid),
        Some("node"),
    ) {
        log::warn!("[taskito-node] worker registration failed: {err}");
    }

    spawn(async move {
        loop {
            tokio::select! {
                _ = stop.notified() => break,
                _ = tokio::time::sleep(HEARTBEAT_INTERVAL) => {
                    if let Err(err) = storage.heartbeat(&worker_id, None) {
                        log::warn!("[taskito-node] worker heartbeat failed: {err}");
                    }
                }
            }
        }
        if let Err(err) = storage.unregister_worker(&worker_id) {
            log::warn!("[taskito-node] worker unregister failed: {err}");
        }
    });
}

/// Mesh-aware scheduler bridge: the scheduler emits jobs into an intermediate
/// channel, which this loop pushes into the mesh local deque (affinity-sorted),
/// then drains the deque to the dispatcher channel and steals from peers when idle.
#[cfg(feature = "mesh")]
async fn run_mesh_bridge(
    scheduler: Arc<Scheduler>,
    mesh_node: Arc<taskito_mesh::MeshNode>,
    job_tx: tokio::sync::mpsc::Sender<taskito_core::job::Job>,
) {
    let (mesh_tx, mut mesh_rx) = tokio::sync::mpsc::channel::<taskito_core::job::Job>(64);

    let sched = scheduler.clone();
    let sched_task = spawn(async move {
        sched.run(mesh_tx).await;
    });

    loop {
        // Drain the local deque to the dispatcher first.
        while let Some(job) = mesh_node.pop_local() {
            if job_tx.send(job).await.is_err() {
                let _ = sched_task.await;
                return;
            }
        }

        // Steal from busier peers when the deque is low and stealing is enabled.
        if mesh_node.should_steal() {
            mesh_node.try_steal().await;
            while let Some(job) = mesh_node.pop_local() {
                if job_tx.send(job).await.is_err() {
                    let _ = sched_task.await;
                    return;
                }
            }
        }

        // Wait for the scheduler to produce more jobs, batching what's ready.
        match mesh_rx.recv().await {
            Some(job) => {
                let mut batch = vec![job];
                while let Ok(extra) = mesh_rx.try_recv() {
                    batch.push(extra);
                }
                mesh_node.prefetch(batch);
            }
            None => break,
        }
    }

    // Scheduler stopped — drain whatever remains in the deque.
    while let Some(job) = mesh_node.pop_local() {
        if job_tx.send(job).await.is_err() {
            break;
        }
    }
    let _ = sched_task.await;
}

/// Translate the JS-facing [`crate::config::MeshWorkerConfig`] into the core
/// mesh config, leaving unspecified fields at their crate defaults.
#[cfg(feature = "mesh")]
#[allow(clippy::field_reassign_with_default)]
fn build_mesh_config(input: &crate::config::MeshWorkerConfig) -> taskito_mesh::MeshConfig {
    let mut config = taskito_mesh::MeshConfig::default();
    config.gossip_port = input.port as u16;
    config.steal_port = input.port.saturating_add(1) as u16;
    if let Some(ref addr) = input.bind_addr {
        config.bind_addr = addr.clone();
    }
    if let Some(ref seeds) = input.seeds {
        config.seeds = seeds.clone();
    }
    if let Some(enabled) = input.steal {
        config.enable_stealing = enabled;
    }
    if let Some(weight) = input.affinity_weight {
        config.affinity_weight = weight;
    }
    if let Some(buffer) = input.local_buffer {
        config.local_buffer_capacity = buffer as usize;
    }
    if let Some(batch) = input.steal_batch {
        config.max_steal_batch = batch as usize;
    }
    if let Some(threshold) = input.steal_threshold {
        config.steal_threshold = threshold as usize;
    }
    if let Some(vnodes) = input.virtual_nodes {
        config.virtual_nodes = vnodes as usize;
    }
    if let Some(ref addr) = input.advertise_addr {
        config.advertise_addr = Some(addr.clone());
    }
    if let Some(ref key) = input.encryption_key {
        config.encryption_key = Some(key.clone());
    }
    if let Some(rate) = input.steal_rate_limit {
        config.steal_rate_limit = rate;
    }
    config
}
