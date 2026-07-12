//! Pub/sub JNI entry points: the topic-subscription registry and `publish`.
//!
//! Fan-out semantics (per-subscriber idempotency-key salting, notes stamping,
//! delivery-settings resolution) live in the core's `publish_to_topic`; this
//! module only marshals arguments and views.

use jni::objects::{JByteArray, JClass, JString};
use jni::sys::{jboolean, jlong, jstring, JNI_FALSE};
use jni::JNIEnv;
use taskito_core::job::now_millis;
use taskito_core::pubsub::publish_to_topic;
use taskito_core::storage::models::NewSubscriptionRow;
use taskito_core::Storage;

use crate::backend;
use crate::convert::{
    build_publish_request, parse_json, to_json, JobView, PublishOptions, SubscriptionView,
};
use crate::ffi::{guard, new_string, read_bytes, read_optional_string, read_string};

use super::{borrow_queue, to_jboolean};

/// `void registerSubscription(long handle, String topic, String subscriptionName,
/// String taskName, String queue, boolean durable, String ownerWorkerIdOrNull)`
/// — insert or update a subscription (idempotent on topic + name).
#[no_mangle]
pub extern "system" fn Java_org_byteveda_taskito_internal_NativeQueue_registerSubscription<
    'local,
>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jlong,
    topic: JString<'local>,
    subscription_name: JString<'local>,
    task_name: JString<'local>,
    queue: JString<'local>,
    durable: jboolean,
    owner_worker_id: JString<'local>,
) {
    guard(&mut env, (), |env| {
        let queue_handle = unsafe { borrow_queue(handle) };
        let topic = read_string(env, &topic)?;
        let subscription_name = read_string(env, &subscription_name)?;
        let task_name = read_string(env, &task_name)?;
        let queue = read_string(env, &queue)?;
        let owner_worker_id = read_optional_string(env, &owner_worker_id)?;
        // An ownerless ephemeral row would never be reaped (the reaper matches
        // on owner) yet keeps receiving deliveries — reject it up front.
        if durable == 0 && owner_worker_id.is_none() {
            return Err(crate::error::BindingError::new(
                "an ephemeral subscription (durable=false) requires ownerWorkerId",
            ));
        }
        let row = NewSubscriptionRow {
            topic: &topic,
            subscription_name: &subscription_name,
            task_name: &task_name,
            queue: &queue,
            // Insert default only: the core upsert preserves an existing row's
            // `active` (and `created_at`), so re-declaring never resumes a pause.
            active: true,
            durable: durable != 0,
            owner_worker_id: owner_worker_id.as_deref(),
            created_at: now_millis(),
        };
        queue_handle.storage.register_subscription(&row)?;
        Ok(())
    })
}

/// `String listSubscriptions(long handle, String topicOrNull)` — a JSON array
/// of subscriptions: all of them, or only a topic's active ones.
#[no_mangle]
pub extern "system" fn Java_org_byteveda_taskito_internal_NativeQueue_listSubscriptions<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jlong,
    topic: JString<'local>,
) -> jstring {
    guard(&mut env, std::ptr::null_mut(), |env| {
        let queue = unsafe { borrow_queue(handle) };
        let rows = match read_optional_string(env, &topic)? {
            Some(topic) => queue.storage.list_subscriptions_for_topic(&topic)?,
            None => queue.storage.list_subscriptions()?,
        };
        let views: Vec<SubscriptionView> = rows.iter().map(SubscriptionView::from).collect();
        new_string(env, to_json(&views)?)
    })
}

/// `boolean unsubscribe(long handle, String topic, String subscriptionName)` —
/// remove a subscription; false if none matched.
#[no_mangle]
pub extern "system" fn Java_org_byteveda_taskito_internal_NativeQueue_unsubscribe<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jlong,
    topic: JString<'local>,
    subscription_name: JString<'local>,
) -> jboolean {
    guard(&mut env, JNI_FALSE, |env| {
        let queue = unsafe { borrow_queue(handle) };
        let topic = read_string(env, &topic)?;
        let subscription_name = read_string(env, &subscription_name)?;
        Ok(to_jboolean(
            queue.storage.unsubscribe(&topic, &subscription_name)?,
        ))
    })
}

/// `boolean setSubscriptionActive(long handle, String topic, String subscriptionName,
/// boolean active)` — pause (false) or resume (true) without unregistering;
/// false if none matched.
#[no_mangle]
pub extern "system" fn Java_org_byteveda_taskito_internal_NativeQueue_setSubscriptionActive<
    'local,
>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jlong,
    topic: JString<'local>,
    subscription_name: JString<'local>,
    active: jboolean,
) -> jboolean {
    guard(&mut env, JNI_FALSE, |env| {
        let queue = unsafe { borrow_queue(handle) };
        let topic = read_string(env, &topic)?;
        let subscription_name = read_string(env, &subscription_name)?;
        Ok(to_jboolean(queue.storage.set_subscription_active(
            &topic,
            &subscription_name,
            active != 0,
        )?))
    })
}

/// `long reapEphemeralSubscriptions(long handle)` — drop ephemeral subscriptions
/// whose owning worker is gone; returns the count removed.
#[no_mangle]
pub extern "system" fn Java_org_byteveda_taskito_internal_NativeQueue_reapEphemeralSubscriptions(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
) -> jlong {
    guard(&mut env, 0, |_env| {
        let queue = unsafe { borrow_queue(handle) };
        Ok(backend::reap_ephemeral_subscriptions(&queue.storage)? as jlong)
    })
}

/// `String publish(long handle, String topic, byte[] payload, String optionsJson)`
/// — fan a payload out to every active subscription of the topic. Returns the
/// created jobs as a JSON array — empty when nothing is subscribed.
#[no_mangle]
pub extern "system" fn Java_org_byteveda_taskito_internal_NativeQueue_publish<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jlong,
    topic: JString<'local>,
    payload: JByteArray<'local>,
    options_json: JString<'local>,
) -> jstring {
    guard(&mut env, std::ptr::null_mut(), |env| {
        let queue = unsafe { borrow_queue(handle) };
        let topic = read_string(env, &topic)?;
        let payload = read_bytes(env, &payload)?;
        let raw_opts = read_string(env, &options_json)?;
        let options: PublishOptions = parse_json(&raw_opts, "publish options")?;
        let request = build_publish_request(topic, payload, options, queue.namespace.as_deref());
        let jobs = publish_to_topic(&queue.storage, &request)?;
        let views: Vec<JobView> = jobs.iter().map(JobView::from).collect();
        new_string(env, to_json(&views)?)
    })
}
