//! JNI entry points backing `org.byteveda.taskito.internal.NativeQueue`.
//!
//! Each function name encodes the Java package, class, and method the JVM links
//! it to. Every body runs inside [`guard`] so failures surface as Java
//! exceptions rather than unwinding across the FFI boundary.

use jni::objects::{JByteArray, JClass, JString};
use jni::sys::{jboolean, jlong, jstring, JNI_FALSE, JNI_TRUE};
use jni::JNIEnv;
use taskito_core::Storage;

use crate::backend::{self, QueueHandle};
use crate::convert::{
    build_new_job, parse_json, to_json, EnqueueOptions, JobView, OpenOptions, StatsView,
};
use crate::ffi::{guard, new_string, read_bytes, read_string};
use crate::handle::{borrow, drop_handle, into_handle};

/// Borrow the queue behind a handle.
///
/// # Safety
/// `handle` must be a live `QueueHandle` pointer (see [`crate::handle`]).
unsafe fn queue<'a>(handle: jlong) -> &'a QueueHandle {
    borrow::<QueueHandle>(handle)
}

/// `long open(String optionsJson)` — open a backend, returning its handle.
#[no_mangle]
pub extern "system" fn Java_org_byteveda_taskito_internal_NativeQueue_open<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    options_json: JString<'local>,
) -> jlong {
    guard(&mut env, 0, |env| {
        let raw = read_string(env, &options_json)?;
        let options: OpenOptions = parse_json(&raw, "open options")?;
        Ok(into_handle(backend::open(options)?))
    })
}

/// `void close(long handle)` — reclaim a handle. A zero handle is a no-op.
#[no_mangle]
pub extern "system" fn Java_org_byteveda_taskito_internal_NativeQueue_close(
    _env: JNIEnv,
    _class: JClass,
    handle: jlong,
) {
    if handle != 0 {
        unsafe { drop_handle::<QueueHandle>(handle) };
    }
}

/// `String enqueue(long handle, String taskName, byte[] payload, String optionsJson)`
/// — enqueue a job and return its id. A set `uniqueKey` makes a duplicate
/// enqueue a no-op while the first job is pending/running (idempotency).
#[no_mangle]
pub extern "system" fn Java_org_byteveda_taskito_internal_NativeQueue_enqueue<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jlong,
    task_name: JString<'local>,
    payload: JByteArray<'local>,
    options_json: JString<'local>,
) -> jstring {
    guard(&mut env, std::ptr::null_mut(), |env| {
        let queue = unsafe { queue(handle) };
        let task = read_string(env, &task_name)?;
        let bytes = read_bytes(env, &payload)?;
        let raw_opts = read_string(env, &options_json)?;
        let options: EnqueueOptions = parse_json(&raw_opts, "enqueue options")?;
        let unique = options.unique_key.is_some();
        let new_job = build_new_job(task, bytes, options, queue.namespace.as_deref());
        let job = if unique {
            queue.storage.enqueue_unique(new_job)
        } else {
            queue.storage.enqueue(new_job)
        }?;
        new_string(env, job.id)
    })
}

/// `String getJob(long handle, String jobId)` — a JSON [`JobView`], or `null`
/// when no such job exists.
#[no_mangle]
pub extern "system" fn Java_org_byteveda_taskito_internal_NativeQueue_getJob<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jlong,
    job_id: JString<'local>,
) -> jstring {
    guard(&mut env, std::ptr::null_mut(), |env| {
        let queue = unsafe { queue(handle) };
        let id = read_string(env, &job_id)?;
        match queue.storage.get_job(&id)? {
            Some(job) => new_string(env, to_json(&JobView::from(&job))?),
            None => Ok(std::ptr::null_mut()),
        }
    })
}

/// `boolean cancel(long handle, String jobId)` — cancel a pending job. Returns
/// false when the job was not pending.
#[no_mangle]
pub extern "system" fn Java_org_byteveda_taskito_internal_NativeQueue_cancel<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jlong,
    job_id: JString<'local>,
) -> jboolean {
    guard(&mut env, JNI_FALSE, |env| {
        let queue = unsafe { queue(handle) };
        let id = read_string(env, &job_id)?;
        Ok(if queue.storage.cancel_job(&id)? {
            JNI_TRUE
        } else {
            JNI_FALSE
        })
    })
}

/// `String stats(long handle)` — a JSON [`StatsView`] of job counts by status.
#[no_mangle]
pub extern "system" fn Java_org_byteveda_taskito_internal_NativeQueue_stats<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jlong,
) -> jstring {
    guard(&mut env, std::ptr::null_mut(), |env| {
        let queue = unsafe { queue(handle) };
        let stats = queue.storage.stats()?;
        new_string(env, to_json(&StatsView::from(stats))?)
    })
}
