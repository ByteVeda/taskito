//! Topic pub/sub fan-out: one job per active subscription.
//!
//! Lives in the core (not the language shells) so every binding shares the
//! same fan-out semantics — in particular the idempotency-key salting, which
//! silently drops deliveries if a shell gets it wrong.

use std::collections::HashMap;

use crate::error::Result;
use crate::job::{Job, NewJob};
use crate::storage::models::SubscriptionRow;
use crate::storage::Storage;

/// Per-task delivery settings a subscriber's task declared at registration.
/// Shells pass what their task registry knows; unknown tasks fall back to
/// the queue-level defaults.
#[derive(Clone, Copy)]
pub struct DeliveryDefaults {
    pub priority: i32,
    pub max_retries: i32,
    pub timeout_ms: i64,
}

/// Everything a publish shares across the jobs it fans out to. Per-subscriber
/// routing (task name, queue) comes from the subscription registry; delivery
/// settings resolve per field as explicit publish override, then the
/// subscriber task's own defaults, then the queue defaults.
pub struct PublishRequest {
    pub topic: String,
    /// Wire-envelope payload bytes; every subscriber receives the same body.
    pub payload: Vec<u8>,
    /// Salted per subscription identity (topic + name, length-prefixed so
    /// delimiter characters in either part cannot collide) before becoming a
    /// job `unique_key`: the jobs table's unique index is global, so reusing
    /// the raw key across the fan-out would dedup away all but one delivery.
    pub idempotency_key: Option<String>,
    pub metadata: Option<String>,
    /// Pre-validated canonical notes JSON object (see `Job::notes`); the
    /// topic and subscription name are stamped in per delivery.
    pub notes: Option<String>,
    pub priority: Option<i32>,
    pub scheduled_at: i64,
    pub max_retries: Option<i32>,
    pub timeout_ms: Option<i64>,
    pub expires_at: Option<i64>,
    pub result_ttl_ms: Option<i64>,
    pub namespace: Option<String>,
    pub queue_defaults: DeliveryDefaults,
    pub task_defaults: HashMap<String, DeliveryDefaults>,
}

/// Fan a message out to every active subscription of `topic` as ordinary
/// jobs. Returns the created jobs — empty when the topic has no active
/// subscriptions (a valid pub/sub no-op, not an error).
///
/// Keyed publishes go through `enqueue_unique` per delivery so a re-published
/// event dedups per subscriber instead of failing the whole batch on the
/// unique index; unkeyed publishes use one batch insert.
pub fn publish_to_topic<S: Storage>(storage: &S, request: &PublishRequest) -> Result<Vec<Job>> {
    let subscriptions = storage.list_subscriptions_for_topic(&request.topic)?;
    if subscriptions.is_empty() {
        return Ok(Vec::new());
    }
    let jobs: Vec<NewJob> = subscriptions
        .iter()
        .map(|sub| delivery_job(request, sub))
        .collect();
    if request.idempotency_key.is_none() {
        return storage.enqueue_batch(jobs);
    }
    jobs.into_iter()
        .map(|job| storage.enqueue_unique(job))
        .collect()
}

/// `key::<topic_len>:<name_len>:<topic><name>` — length prefixes make the
/// encoding injective, so distinct (topic, name) pairs can never produce the
/// same salted key even when the parts contain the delimiter characters.
fn salted_unique_key(key: &str, topic: &str, subscription_name: &str) -> String {
    format!(
        "{key}::{}:{}:{topic}{subscription_name}",
        topic.len(),
        subscription_name.len()
    )
}

fn delivery_job(request: &PublishRequest, sub: &SubscriptionRow) -> NewJob {
    let task = request
        .task_defaults
        .get(&sub.task_name)
        .copied()
        .unwrap_or(request.queue_defaults);
    NewJob {
        queue: sub.queue.clone(),
        task_name: sub.task_name.clone(),
        payload: request.payload.clone(),
        priority: request.priority.unwrap_or(task.priority),
        scheduled_at: request.scheduled_at,
        max_retries: request.max_retries.unwrap_or(task.max_retries),
        timeout_ms: request.timeout_ms.unwrap_or(task.timeout_ms),
        unique_key: request
            .idempotency_key
            .as_ref()
            .map(|key| salted_unique_key(key, &request.topic, &sub.subscription_name)),
        metadata: request.metadata.clone(),
        notes: Some(delivery_notes(request, sub)),
        depends_on: Vec::new(),
        expires_at: request.expires_at,
        result_ttl_ms: request.result_ttl_ms,
        namespace: request.namespace.clone(),
    }
}

/// Stamp `topic` and `subscription` into the caller's notes object so every
/// delivery is filterable per subscriber without a schema change.
fn delivery_notes(request: &PublishRequest, sub: &SubscriptionRow) -> String {
    let mut notes = request
        .notes
        .as_deref()
        .and_then(|raw| {
            serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(raw).ok()
        })
        .unwrap_or_default();
    notes.insert(
        "topic".to_string(),
        serde_json::Value::String(request.topic.clone()),
    );
    notes.insert(
        "subscription".to_string(),
        serde_json::Value::String(sub.subscription_name.clone()),
    );
    serde_json::Value::Object(notes).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::job::now_millis;
    use crate::storage::models::NewSubscriptionRow;
    use crate::SqliteStorage;

    fn request(topic: &str, idempotency_key: Option<&str>) -> PublishRequest {
        PublishRequest {
            topic: topic.to_string(),
            payload: vec![0x02, 0xf5],
            idempotency_key: idempotency_key.map(str::to_string),
            metadata: None,
            notes: None,
            priority: None,
            scheduled_at: now_millis(),
            max_retries: None,
            timeout_ms: None,
            expires_at: None,
            result_ttl_ms: None,
            namespace: None,
            queue_defaults: DeliveryDefaults {
                priority: 0,
                max_retries: 3,
                timeout_ms: 300_000,
            },
            task_defaults: HashMap::new(),
        }
    }

    fn subscribe(storage: &SqliteStorage, topic: &str, name: &str, task: &str) {
        storage
            .register_subscription(&NewSubscriptionRow {
                topic,
                subscription_name: name,
                task_name: task,
                queue: "default",
                active: true,
                durable: true,
                owner_worker_id: None,
                created_at: now_millis(),
            })
            .unwrap();
    }

    #[test]
    fn publish_with_no_subscriptions_is_a_no_op() {
        let storage = SqliteStorage::in_memory().unwrap();
        let jobs = publish_to_topic(&storage, &request("orders", None)).unwrap();
        assert!(jobs.is_empty());
    }

    #[test]
    fn publish_fans_out_one_job_per_subscription() {
        let storage = SqliteStorage::in_memory().unwrap();
        subscribe(&storage, "orders", "email", "send_email");
        subscribe(&storage, "orders", "analytics", "track_order");

        let jobs = publish_to_topic(&storage, &request("orders", None)).unwrap();

        assert_eq!(jobs.len(), 2);
        let mut tasks: Vec<_> = jobs.iter().map(|j| j.task_name.as_str()).collect();
        tasks.sort_unstable();
        assert_eq!(tasks, ["send_email", "track_order"]);
        assert!(jobs.iter().all(|j| j.payload == vec![0x02, 0xf5]));
    }

    #[test]
    fn idempotency_key_is_salted_per_subscription() {
        // The jobs unique index is global: an unsalted key would let only the
        // first fan-out insert win and silently drop the other deliveries.
        let storage = SqliteStorage::in_memory().unwrap();
        subscribe(&storage, "orders", "email", "send_email");
        subscribe(&storage, "orders", "analytics", "track_order");

        let first = publish_to_topic(&storage, &request("orders", Some("evt-42"))).unwrap();
        assert_eq!(first.len(), 2);
        let mut keys: Vec<_> = first.iter().filter_map(|j| j.unique_key.clone()).collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            ["evt-42::6:5:ordersemail", "evt-42::6:9:ordersanalytics"]
        );

        // Same event published twice: every subscriber still has exactly one
        // delivery (per-subscriber dedup), not zero and not two.
        let second = publish_to_topic(&storage, &request("orders", Some("evt-42"))).unwrap();
        assert_eq!(second.len(), 2);
        assert_eq!(
            first.iter().map(|j| &j.id).collect::<Vec<_>>(),
            second.iter().map(|j| &j.id).collect::<Vec<_>>(),
        );
    }

    #[test]
    fn delivery_settings_resolve_override_then_task_then_queue() {
        let storage = SqliteStorage::in_memory().unwrap();
        subscribe(&storage, "orders", "email", "send_email");
        subscribe(&storage, "orders", "audit", "audit_log");

        let mut req = request("orders", None);
        req.task_defaults.insert(
            "send_email".to_string(),
            DeliveryDefaults {
                priority: 5,
                max_retries: 0,
                timeout_ms: 60_000,
            },
        );
        let jobs = publish_to_topic(&storage, &req).unwrap();
        let by_task: HashMap<_, _> = jobs.iter().map(|j| (j.task_name.as_str(), j)).collect();
        // send_email declared its own settings; audit_log falls back to queue defaults.
        assert_eq!(by_task["send_email"].max_retries, 0);
        assert_eq!(by_task["send_email"].priority, 5);
        assert_eq!(by_task["audit_log"].max_retries, 3);

        // An explicit publish-level override beats both.
        let mut req = request("orders", None);
        req.max_retries = Some(9);
        let jobs = publish_to_topic(&storage, &req).unwrap();
        assert!(jobs.iter().all(|j| j.max_retries == 9));
    }

    #[test]
    fn paused_subscriptions_are_skipped() {
        let storage = SqliteStorage::in_memory().unwrap();
        subscribe(&storage, "orders", "email", "send_email");
        subscribe(&storage, "orders", "analytics", "track_order");
        storage
            .set_subscription_active("orders", "analytics", false)
            .unwrap();

        let jobs = publish_to_topic(&storage, &request("orders", None)).unwrap();
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].task_name, "send_email");
    }

    #[test]
    fn deliveries_carry_topic_and_subscription_notes() {
        let storage = SqliteStorage::in_memory().unwrap();
        subscribe(&storage, "orders", "email", "send_email");

        let mut req = request("orders", None);
        req.notes = Some(r#"{"tenant":"acme"}"#.to_string());
        let jobs = publish_to_topic(&storage, &req).unwrap();

        let notes: serde_json::Value =
            serde_json::from_str(jobs[0].notes.as_deref().unwrap()).unwrap();
        assert_eq!(notes["topic"], "orders");
        assert_eq!(notes["subscription"], "email");
        assert_eq!(notes["tenant"], "acme");
    }
}
