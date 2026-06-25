//! Task-log entry points for `NativeQueue`.

use jni::objects::{JClass, JString};
use jni::sys::{jlong, jstring};
use jni::JNIEnv;
use taskito_core::Storage;

use super::borrow_queue;
use crate::convert::{to_json, LogView};
use crate::ffi::{guard, new_string, read_optional_string, read_string};

/// `void writeTaskLog(long handle, String jobId, String taskName, String level, String message, String extraOrNull)`.
#[no_mangle]
pub extern "system" fn Java_org_byteveda_taskito_internal_NativeQueue_writeTaskLog<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jlong,
    job_id: JString<'local>,
    task_name: JString<'local>,
    level: JString<'local>,
    message: JString<'local>,
    extra: JString<'local>,
) {
    guard(&mut env, (), |env| {
        let queue = unsafe { borrow_queue(handle) };
        let job_id = read_string(env, &job_id)?;
        let task_name = read_string(env, &task_name)?;
        let level = read_string(env, &level)?;
        let message = read_string(env, &message)?;
        let extra = read_optional_string(env, &extra)?;
        queue
            .storage
            .write_task_log(&job_id, &task_name, &level, &message, extra.as_deref())?;
        Ok(())
    })
}

/// `String getTaskLogs(long handle, String jobId)` — a JSON array of log lines.
#[no_mangle]
pub extern "system" fn Java_org_byteveda_taskito_internal_NativeQueue_getTaskLogs<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jlong,
    job_id: JString<'local>,
) -> jstring {
    guard(&mut env, std::ptr::null_mut(), |env| {
        let queue = unsafe { borrow_queue(handle) };
        let id = read_string(env, &job_id)?;
        let logs = queue.storage.get_task_logs(&id)?;
        let views: Vec<LogView> = logs.iter().map(LogView::from).collect();
        new_string(env, to_json(&views)?)
    })
}
