//! Worker wiring and the `NativeWorker` / `NativeQueue.runWorker` entry points.
//!
//! Mirrors the Node shell's `start_worker`: a scheduler loop feeds jobs to the
//! [`JavaDispatcher`], a result-drain loop applies outcomes and surfaces them to
//! Java for events/middleware, and a lifecycle loop registers + heartbeats the
//! worker. The completion registry (see [`crate::dispatcher`]) lets Java report
//! each job's outcome back.

use std::sync::Arc;
use std::time::Duration;

use jni::objects::{GlobalRef, JByteArray, JClass, JObject, JString, JValue};
use jni::sys::jlong;
use jni::JNIEnv;
use taskito_core::resilience::retry::RetryPolicy;
use taskito_core::scheduler::{ResultOutcome, TaskConfig};
use taskito_core::worker::WorkerDispatcher;
use taskito_core::{Scheduler, SchedulerConfig, Storage, StorageBackend};
use tokio::sync::Notify;

use crate::backend::QueueHandle;
use crate::convert::{parse_json, TaskRetryConfig, WorkerOptions};
use crate::dispatcher::{JavaDispatcher, Registry, TaskOutcome};
use crate::ffi::{guard, read_bytes, read_string};
use crate::handle::{self, drop_handle, into_handle};
use crate::jvm;

const DEFAULT_QUEUE: &str = "default";
const DEFAULT_CHANNEL_CAPACITY: usize = 128;
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(5);

/// A running worker. The tokio runtime and the completion registry are held here
/// for the worker's lifetime; the registry's pointer (this handle) stays valid
/// until [`close`] runs. Fields drop in declaration order: the runtime stops
/// first (joining tasks), then the registry's last reference is released.
pub struct WorkerHandle {
    _runtime: tokio::runtime::Runtime,
    registry: Arc<Registry>,
    shutdown: Arc<Notify>,
    heartbeat_stop: Arc<Notify>,
}

/// Build and start a worker over `storage`, calling back into the Java
/// `WorkerBridge` (`callbacks`) for each job.
fn start_worker(
    storage: StorageBackend,
    namespace: Option<String>,
    options: WorkerOptions,
    callbacks: GlobalRef,
) -> Result<WorkerHandle, crate::error::BindingError> {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|e| crate::error::BindingError::new(format!("failed to start runtime: {e}")))?;

    let queues = options
        .queues
        .unwrap_or_else(|| vec![DEFAULT_QUEUE.to_string()]);
    let capacity = options
        .channel_capacity
        .map(|c| (c as usize).max(1))
        .unwrap_or(DEFAULT_CHANNEL_CAPACITY);
    let mut config = SchedulerConfig::default();
    if let Some(batch) = options.batch_size {
        config.batch_size = batch.max(1) as usize;
    }

    let registry = Arc::new(Registry::default());
    let dispatcher_storage = storage.clone();
    let lifecycle_storage = storage.clone();
    let queues_csv = queues.join(",");
    let worker_id = format!("java-{}", uuid::Uuid::now_v7());

    let mut scheduler = Scheduler::new(storage, queues, config, namespace);
    register_task_policies(&mut scheduler, options.task_configs);
    let scheduler = Arc::new(scheduler);
    let shutdown = scheduler.shutdown_handle();
    let heartbeat_stop = Arc::new(Notify::new());

    let (job_tx, job_rx) = tokio::sync::mpsc::channel(capacity);
    // Unbounded so the dispatcher's `result_tx.send` (which runs inside a Tokio
    // task) never blocks a runtime worker when the drain loop is momentarily
    // slow. In-flight jobs are already bounded by the job channel + scheduler,
    // so the result queue can't grow without bound.
    let (result_tx, result_rx) = crossbeam_channel::unbounded();

    // Scheduler loop: poll storage and dispatch ready jobs.
    let scheduler_run = scheduler.clone();
    runtime.spawn(async move {
        scheduler_run.run(job_tx).await;
    });

    // Dispatcher loop: submit each job to Java, report results.
    let dispatcher = JavaDispatcher::new(callbacks.clone(), registry.clone(), dispatcher_storage);
    runtime.spawn(async move {
        dispatcher.run(job_rx, result_tx).await;
    });

    // Result-drain loop: apply outcomes and surface them to Java. crossbeam
    // `recv` is blocking, so it runs on a blocking thread; it exits when the
    // result sender has dropped (dispatcher done).
    let drain_scheduler = scheduler;
    let drain_callbacks = callbacks;
    runtime.spawn_blocking(move || drain_results(result_rx, drain_scheduler, drain_callbacks));

    // Lifecycle loop: register, heartbeat, unregister.
    spawn_lifecycle(
        &runtime,
        lifecycle_storage,
        worker_id,
        queues_csv,
        capacity,
        heartbeat_stop.clone(),
    );

    Ok(WorkerHandle {
        _runtime: runtime,
        registry,
        shutdown,
        heartbeat_stop,
    })
}

/// Register each task's retry-backoff curve with the scheduler. Only the curve
/// is set here — the core resolves the retry budget from the job's `max_retries`
/// — so unset fields keep the core [`RetryPolicy`] defaults.
fn register_task_policies(scheduler: &mut Scheduler, configs: Option<Vec<TaskRetryConfig>>) {
    let Some(configs) = configs else { return };
    for config in configs {
        let mut retry_policy = RetryPolicy::default();
        if let Some(base) = config.base_delay_ms {
            retry_policy.base_delay_ms = base;
        }
        if let Some(max) = config.max_delay_ms {
            retry_policy.max_delay_ms = max;
        }
        if config.custom_delays_ms.is_some() {
            retry_policy.custom_delays_ms = config.custom_delays_ms;
        }
        scheduler.register_task(
            config.name,
            TaskConfig {
                retry_policy,
                rate_limit: None,
                circuit_breaker: None,
                max_concurrent: None,
            },
        );
    }
}

/// Drain results: apply each to storage and invoke `WorkerBridge.onOutcome`.
fn drain_results(
    result_rx: crossbeam_channel::Receiver<taskito_core::scheduler::JobResult>,
    scheduler: Arc<Scheduler>,
    callbacks: GlobalRef,
) {
    let vm = jvm::vm();
    let mut env = match vm.attach_current_thread() {
        Ok(env) => env,
        Err(e) => {
            log::error!("[taskito-java] drain attach failed: {e}");
            return;
        }
    };
    while let Ok(result) = result_rx.recv() {
        let outcome = match scheduler.handle_result(result) {
            Ok(outcome) => outcome,
            Err(e) => {
                log::error!("[taskito-java] result handling error: {e}");
                continue;
            }
        };
        // Each outcome allocates several JNI locals on this long-lived attached
        // env; scope them in a frame so a busy worker can't exhaust the
        // local-reference table over the loop's lifetime.
        let framed = env.with_local_frame(16, |env| {
            if let Err(e) = call_on_outcome(env, &callbacks, &outcome) {
                log::error!("[taskito-java] onOutcome failed: {e}");
            }
            Ok::<(), jni::errors::Error>(())
        });
        if let Err(e) = framed {
            log::error!("[taskito-java] drain local frame failed: {e}");
        }
    }
}

/// Invoke `WorkerBridge.onOutcome` for one finished job.
fn call_on_outcome(
    env: &mut JNIEnv,
    callbacks: &GlobalRef,
    outcome: &ResultOutcome,
) -> Result<(), String> {
    let (kind, job_id, task_name, error, retry_count, timed_out) = describe(outcome);
    let kind_s = env.new_string(kind).map_err(|e| e.to_string())?;
    let job_s = env.new_string(job_id).map_err(|e| e.to_string())?;
    let task_s = env.new_string(task_name).map_err(|e| e.to_string())?;
    let error_obj: JObject = match error {
        Some(e) => env.new_string(e).map_err(|x| x.to_string())?.into(),
        None => JObject::null(),
    };
    // Clear a pending exception on the `Err(JavaException)` path before
    // returning, so a thrown listener can't poison the reused env.
    if let Err(e) = env.call_method(
        callbacks,
        "onOutcome",
        "(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;IZ)V",
        &[
            JValue::Object(&kind_s),
            JValue::Object(&job_s),
            JValue::Object(&task_s),
            JValue::Object(&error_obj),
            JValue::Int(retry_count),
            JValue::Bool(u8::from(timed_out)),
        ],
    ) {
        let _ = env.exception_clear();
        return Err(e.to_string());
    }
    if env.exception_check().unwrap_or(false) {
        let _ = env.exception_clear();
        return Err("WorkerBridge.onOutcome threw".to_string());
    }
    Ok(())
}

/// Flatten a [`ResultOutcome`] into the fields `onOutcome` receives. `retry_count`
/// is -1 when not applicable.
fn describe(outcome: &ResultOutcome) -> (&str, &str, &str, Option<&str>, i32, bool) {
    match outcome {
        ResultOutcome::Success { job_id, task_name } => {
            ("success", job_id, task_name, None, -1, false)
        }
        ResultOutcome::Retry {
            job_id,
            task_name,
            error,
            retry_count,
            timed_out,
            ..
        } => (
            "retry",
            job_id,
            task_name,
            Some(error),
            *retry_count,
            *timed_out,
        ),
        ResultOutcome::DeadLettered {
            job_id,
            task_name,
            error,
            timed_out,
            ..
        } => ("dead", job_id, task_name, Some(error), -1, *timed_out),
        ResultOutcome::Cancelled {
            job_id, task_name, ..
        } => ("cancelled", job_id, task_name, None, -1, false),
    }
}

/// Register the worker, heartbeat every 5s until stopped, then unregister.
fn spawn_lifecycle(
    runtime: &tokio::runtime::Runtime,
    storage: StorageBackend,
    worker_id: String,
    queues_csv: String,
    capacity: usize,
    stop: Arc<Notify>,
) {
    let hostname = gethostname::gethostname().to_string_lossy().to_string();
    let pid = std::process::id() as i32;
    if let Err(e) = storage.register_worker(
        &worker_id,
        &queues_csv,
        None,
        None,
        None,
        capacity as i32,
        Some(&hostname),
        Some(pid),
        Some("java"),
    ) {
        log::warn!("[taskito-java] worker registration failed: {e}");
    }
    runtime.spawn(async move {
        loop {
            tokio::select! {
                _ = stop.notified() => break,
                _ = tokio::time::sleep(HEARTBEAT_INTERVAL) => {
                    if let Err(e) = storage.heartbeat(&worker_id, None) {
                        log::warn!("[taskito-java] worker heartbeat failed: {e}");
                    }
                }
            }
        }
        if let Err(e) = storage.unregister_worker(&worker_id) {
            log::warn!("[taskito-java] worker unregister failed: {e}");
        }
    });
}

/// Borrow a worker handle.
///
/// # Safety
/// `handle` must be a live `WorkerHandle` pointer from [`start_worker`].
unsafe fn borrow_worker<'a>(handle: jlong) -> &'a WorkerHandle {
    handle::borrow::<WorkerHandle>(handle)
}

/// `long runWorker(long queueHandle, Object bridge, String optionsJson)` — start
/// a worker; returns its handle. `bridge` is a Java `WorkerBridge`.
#[no_mangle]
pub extern "system" fn Java_org_byteveda_taskito_internal_NativeQueue_runWorker<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    queue_handle: jlong,
    bridge: JObject<'local>,
    options_json: JString<'local>,
) -> jlong {
    guard(&mut env, 0, |env| {
        let queue = unsafe { handle::borrow::<QueueHandle>(queue_handle) };
        let raw = read_string(env, &options_json)?;
        let options: WorkerOptions = parse_json(&raw, "worker options")?;
        let callbacks = env
            .new_global_ref(&bridge)
            .map_err(|e| crate::error::BindingError::new(format!("global ref failed: {e}")))?;
        let worker = start_worker(
            queue.storage.clone(),
            queue.namespace.clone(),
            options,
            callbacks,
        )?;
        Ok(into_handle(worker))
    })
}

/// `void completeJob(long workerHandle, long token, byte[] result)`.
#[no_mangle]
pub extern "system" fn Java_org_byteveda_taskito_internal_NativeWorker_completeJob<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jlong,
    token: jlong,
    result: JByteArray<'local>,
) {
    guard(&mut env, (), |env| {
        let worker = unsafe { borrow_worker(handle) };
        let bytes = read_bytes(env, &result)?;
        worker
            .registry
            .complete(token as u64, TaskOutcome::Success(bytes));
        Ok(())
    })
}

/// `void failJob(long workerHandle, long token, String error)`.
#[no_mangle]
pub extern "system" fn Java_org_byteveda_taskito_internal_NativeWorker_failJob<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jlong,
    token: jlong,
    error: JString<'local>,
) {
    guard(&mut env, (), |env| {
        let worker = unsafe { borrow_worker(handle) };
        let message = read_string(env, &error)?;
        worker
            .registry
            .complete(token as u64, TaskOutcome::Failure(message));
        Ok(())
    })
}

/// `void cancelJob(long workerHandle, long token)`.
#[no_mangle]
pub extern "system" fn Java_org_byteveda_taskito_internal_NativeWorker_cancelJob(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
    token: jlong,
) {
    guard(&mut env, (), |_env| {
        let worker = unsafe { borrow_worker(handle) };
        worker
            .registry
            .complete(token as u64, TaskOutcome::Cancelled);
        Ok(())
    })
}

/// `void stop(long workerHandle)` — stop the scheduler and heartbeat loops.
#[no_mangle]
pub extern "system" fn Java_org_byteveda_taskito_internal_NativeWorker_stop(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
) {
    guard(&mut env, (), |_env| {
        let worker = unsafe { borrow_worker(handle) };
        worker.shutdown.notify_one();
        worker.heartbeat_stop.notify_one();
        Ok(())
    })
}

/// `void close(long workerHandle)` — stop the runtime and reclaim the handle.
/// The Java side drains its handler executor before calling this, so no
/// `completeJob`/`failJob` can still borrow the handle being freed.
#[no_mangle]
pub extern "system" fn Java_org_byteveda_taskito_internal_NativeWorker_close<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jlong,
) {
    // Dropping the handle stops the runtime (joining tasks); route through
    // `guard` so a panic in that teardown can't unwind across the FFI boundary.
    guard(&mut env, (), |_env| {
        if handle != 0 {
            unsafe { drop_handle::<WorkerHandle>(handle) };
        }
        Ok(())
    })
}
