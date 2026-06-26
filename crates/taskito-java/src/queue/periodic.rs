//! Periodic (cron) task registration. The worker maintenance loop enqueues due
//! tasks; this binds only registration. Re-registering a name replaces it.

use jni::objects::{JByteArray, JClass, JString};
use jni::sys::{jboolean, jlong};
use jni::JNIEnv;
use taskito_core::job::now_millis;
use taskito_core::periodic::{next_cron_time, next_cron_time_tz};
use taskito_core::storage::models::NewPeriodicTaskRow;
use taskito_core::Storage;

use super::borrow_queue;
use crate::ffi::{guard, read_bytes, read_optional_string, read_string};

const DEFAULT_QUEUE: &str = "default";

/// `long registerPeriodic(long handle, String name, String taskName, String cron,
/// byte[] args, String queue, String timezone, boolean enabled)` — register (or
/// replace) a cron task. Returns the next fire time (Unix ms). Rejects bad cron.
#[no_mangle]
pub extern "system" fn Java_org_byteveda_taskito_internal_NativeQueue_registerPeriodic<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jlong,
    name: JString<'local>,
    task_name: JString<'local>,
    cron_expr: JString<'local>,
    args: JByteArray<'local>,
    queue_name: JString<'local>,
    timezone: JString<'local>,
    enabled: jboolean,
) -> jlong {
    guard(&mut env, 0, |env| {
        let queue = unsafe { borrow_queue(handle) };
        let name = read_string(env, &name)?;
        let task = read_string(env, &task_name)?;
        let cron = read_string(env, &cron_expr)?;
        let args_bytes = if args.is_null() {
            None
        } else {
            Some(read_bytes(env, &args)?)
        };
        let queue_name = read_optional_string(env, &queue_name)?;
        let timezone = read_optional_string(env, &timezone)?;

        let now = now_millis();
        let next_run = match timezone.as_deref() {
            Some(tz) => next_cron_time_tz(&cron, now, tz)?,
            None => next_cron_time(&cron, now)?,
        };

        let row = NewPeriodicTaskRow {
            name: &name,
            task_name: &task,
            cron_expr: &cron,
            args: args_bytes.as_deref(),
            kwargs: None,
            queue: queue_name.as_deref().unwrap_or(DEFAULT_QUEUE),
            enabled: enabled != 0,
            next_run,
            timezone: timezone.as_deref(),
        };
        queue.storage.register_periodic(&row)?;
        Ok(next_run)
    })
}
