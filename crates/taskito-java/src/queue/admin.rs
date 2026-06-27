//! Mutating administration entry points for `NativeQueue`.

use jni::objects::{JClass, JString};
use jni::sys::{jboolean, jlong, jstring, JNI_FALSE};
use jni::JNIEnv;
use taskito_core::Storage;

use super::borrow_queue;
use crate::convert::{to_json, DeadJobView};
use crate::ffi::{guard, new_string, read_string};

/// `String listDead(long handle, long limit, long offset)` — dead-letter entries.
#[no_mangle]
pub extern "system" fn Java_org_byteveda_taskito_internal_NativeQueue_listDead<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jlong,
    limit: jlong,
    offset: jlong,
) -> jstring {
    guard(&mut env, std::ptr::null_mut(), |env| {
        let queue = unsafe { borrow_queue(handle) };
        let dead = queue.storage.list_dead(limit.max(0), offset.max(0))?;
        let views: Vec<DeadJobView> = dead.iter().map(DeadJobView::from).collect();
        new_string(env, to_json(&views)?)
    })
}

/// `String retryDead(long handle, String deadId)` — re-enqueue; returns new id.
#[no_mangle]
pub extern "system" fn Java_org_byteveda_taskito_internal_NativeQueue_retryDead<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jlong,
    dead_id: JString<'local>,
) -> jstring {
    guard(&mut env, std::ptr::null_mut(), |env| {
        let queue = unsafe { borrow_queue(handle) };
        let id = read_string(env, &dead_id)?;
        new_string(env, queue.storage.retry_dead(&id)?)
    })
}

/// `boolean deleteDead(long handle, String deadId)`.
#[no_mangle]
pub extern "system" fn Java_org_byteveda_taskito_internal_NativeQueue_deleteDead<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jlong,
    dead_id: JString<'local>,
) -> jboolean {
    guard(&mut env, JNI_FALSE, |env| {
        let queue = unsafe { borrow_queue(handle) };
        let id = read_string(env, &dead_id)?;
        Ok(super::to_jboolean(queue.storage.delete_dead(&id)?))
    })
}

/// `long purgeDead(long handle, long olderThanMs)` — returns rows removed.
#[no_mangle]
pub extern "system" fn Java_org_byteveda_taskito_internal_NativeQueue_purgeDead<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jlong,
    older_than_ms: jlong,
) -> jlong {
    guard(&mut env, 0, |_env| {
        let queue = unsafe { borrow_queue(handle) };
        Ok(queue.storage.purge_dead(older_than_ms)? as jlong)
    })
}

/// `String listDeadByTask(long handle, String taskName, long limit, long offset)`
/// — dead-letter entries for one task, as a JSON array.
#[no_mangle]
pub extern "system" fn Java_org_byteveda_taskito_internal_NativeQueue_listDeadByTask<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jlong,
    task_name: JString<'local>,
    limit: jlong,
    offset: jlong,
) -> jstring {
    guard(&mut env, std::ptr::null_mut(), |env| {
        let queue = unsafe { borrow_queue(handle) };
        let task = read_string(env, &task_name)?;
        let dead = queue
            .storage
            .list_dead_by_task(&task, limit.max(0), offset.max(0))?;
        let views: Vec<DeadJobView> = dead.iter().map(DeadJobView::from).collect();
        new_string(env, to_json(&views)?)
    })
}

/// `long purgeDeadByTask(long handle, String taskName)` — returns rows removed.
#[no_mangle]
pub extern "system" fn Java_org_byteveda_taskito_internal_NativeQueue_purgeDeadByTask<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jlong,
    task_name: JString<'local>,
) -> jlong {
    guard(&mut env, 0, |env| {
        let queue = unsafe { borrow_queue(handle) };
        let task = read_string(env, &task_name)?;
        Ok(queue.storage.purge_dead_by_task(&task)? as jlong)
    })
}

/// `long purgeCompleted(long handle, long olderThanMs)` — returns rows removed.
#[no_mangle]
pub extern "system" fn Java_org_byteveda_taskito_internal_NativeQueue_purgeCompleted<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jlong,
    older_than_ms: jlong,
) -> jlong {
    guard(&mut env, 0, |_env| {
        let queue = unsafe { borrow_queue(handle) };
        Ok(queue.storage.purge_completed(older_than_ms)? as jlong)
    })
}

/// `void pauseQueue(long handle, String queue)`.
#[no_mangle]
pub extern "system" fn Java_org_byteveda_taskito_internal_NativeQueue_pauseQueue<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jlong,
    queue_name: JString<'local>,
) {
    guard(&mut env, (), |env| {
        let queue = unsafe { borrow_queue(handle) };
        let name = read_string(env, &queue_name)?;
        queue.storage.pause_queue(&name)?;
        Ok(())
    })
}

/// `void resumeQueue(long handle, String queue)`.
#[no_mangle]
pub extern "system" fn Java_org_byteveda_taskito_internal_NativeQueue_resumeQueue<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jlong,
    queue_name: JString<'local>,
) {
    guard(&mut env, (), |env| {
        let queue = unsafe { borrow_queue(handle) };
        let name = read_string(env, &queue_name)?;
        queue.storage.resume_queue(&name)?;
        Ok(())
    })
}

/// `String listPausedQueues(long handle)` — a JSON array of queue names.
#[no_mangle]
pub extern "system" fn Java_org_byteveda_taskito_internal_NativeQueue_listPausedQueues<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jlong,
) -> jstring {
    guard(&mut env, std::ptr::null_mut(), |env| {
        let queue = unsafe { borrow_queue(handle) };
        new_string(env, to_json(&queue.storage.list_paused_queues()?)?)
    })
}

/// `String getSetting(long handle, String key)` — value, or `null` if unset.
#[no_mangle]
pub extern "system" fn Java_org_byteveda_taskito_internal_NativeQueue_getSetting<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jlong,
    key: JString<'local>,
) -> jstring {
    guard(&mut env, std::ptr::null_mut(), |env| {
        let queue = unsafe { borrow_queue(handle) };
        let key = read_string(env, &key)?;
        match queue.storage.get_setting(&key)? {
            Some(value) => new_string(env, value),
            None => Ok(std::ptr::null_mut()),
        }
    })
}

/// `void setSetting(long handle, String key, String value)`.
#[no_mangle]
pub extern "system" fn Java_org_byteveda_taskito_internal_NativeQueue_setSetting<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jlong,
    key: JString<'local>,
    value: JString<'local>,
) {
    guard(&mut env, (), |env| {
        let queue = unsafe { borrow_queue(handle) };
        let key = read_string(env, &key)?;
        let value = read_string(env, &value)?;
        queue.storage.set_setting(&key, &value)?;
        Ok(())
    })
}

/// `boolean deleteSetting(long handle, String key)`.
#[no_mangle]
pub extern "system" fn Java_org_byteveda_taskito_internal_NativeQueue_deleteSetting<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jlong,
    key: JString<'local>,
) -> jboolean {
    guard(&mut env, JNI_FALSE, |env| {
        let queue = unsafe { borrow_queue(handle) };
        let key = read_string(env, &key)?;
        Ok(super::to_jboolean(queue.storage.delete_setting(&key)?))
    })
}

/// `String listSettings(long handle)` — a JSON map of key to value.
#[no_mangle]
pub extern "system" fn Java_org_byteveda_taskito_internal_NativeQueue_listSettings<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jlong,
) -> jstring {
    guard(&mut env, std::ptr::null_mut(), |env| {
        let queue = unsafe { borrow_queue(handle) };
        new_string(env, to_json(&queue.storage.list_settings()?)?)
    })
}
