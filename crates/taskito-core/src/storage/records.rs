//! Plain-data records returned and accepted by the [`Storage`](super::Storage)
//! trait. ORM-free by design: the Diesel row structs live in the private
//! `models` module and convert to/from these at the query boundary, so the
//! public API never exposes backend implementation details.
//!
//! Field names mirror the storage columns on purpose — the Redis backend
//! persists some of these as JSON, so renaming a field is a wire change.

use serde::{Deserialize, Serialize};

/// One recorded failure attempt for a job.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobError {
    pub id: String,
    pub job_id: String,
    pub attempt: i32,
    pub error: String,
    pub failed_at: i64,
}

/// Token-bucket state for a rate-limit key.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RateLimitState {
    pub key: String,
    pub tokens: f64,
    pub max_tokens: f64,
    pub refill_rate: f64,
    pub last_refill: i64,
}

/// A registered periodic (cron) task.
#[derive(Debug, Clone)]
pub struct PeriodicTask {
    pub name: String,
    pub task_name: String,
    pub cron_expr: String,
    pub args: Option<Vec<u8>>,
    pub kwargs: Option<Vec<u8>>,
    pub queue: String,
    pub enabled: bool,
    pub last_run: Option<i64>,
    pub next_run: i64,
    pub timezone: Option<String>,
}

/// Registration payload for a periodic task. `last_run` starts unset.
#[derive(Debug, Clone)]
pub struct NewPeriodicTask {
    pub name: String,
    pub task_name: String,
    pub cron_expr: String,
    pub args: Option<Vec<u8>>,
    pub kwargs: Option<Vec<u8>>,
    pub queue: String,
    pub enabled: bool,
    pub next_run: i64,
    pub timezone: Option<String>,
}

/// A topic subscription in the pub/sub registry.
///
/// The natural composite key is `(topic, subscription_name)`. A `None`
/// `owner_worker_id` marks a durable subscription that persists until an
/// explicit unsubscribe; a set owner marks an ephemeral one that is reaped
/// when its worker dies.
#[derive(Debug, Clone)]
pub struct Subscription {
    pub topic: String,
    pub subscription_name: String,
    pub task_name: String,
    pub queue: String,
    pub active: bool,
    pub durable: bool,
    pub owner_worker_id: Option<String>,
    pub created_at: i64,
    /// Per-subscription delivery settings persisted at registration so
    /// `publish_to_topic` applies them cross-process. `None` = queue default.
    pub priority: Option<i32>,
    pub max_retries: Option<i32>,
    pub timeout_ms: Option<i64>,
}

/// Registration payload for a topic subscription.
#[derive(Debug, Clone)]
pub struct NewSubscription {
    pub topic: String,
    pub subscription_name: String,
    pub task_name: String,
    pub queue: String,
    pub active: bool,
    pub durable: bool,
    pub owner_worker_id: Option<String>,
    pub created_at: i64,
    pub priority: Option<i32>,
    pub max_retries: Option<i32>,
    pub timeout_ms: Option<i64>,
}

/// One execution measurement for a task.
#[derive(Debug, Clone)]
pub struct TaskMetric {
    pub id: String,
    pub task_name: String,
    pub job_id: String,
    pub wall_time_ns: i64,
    pub memory_bytes: i64,
    pub succeeded: bool,
    pub recorded_at: i64,
}

/// One replay of a completed job, pairing original and replay outcomes.
#[derive(Debug, Clone)]
pub struct ReplayEntry {
    pub id: String,
    pub original_job_id: String,
    pub replay_job_id: String,
    pub replayed_at: i64,
    pub original_result: Option<Vec<u8>>,
    pub replay_result: Option<Vec<u8>>,
    pub original_error: Option<String>,
    pub replay_error: Option<String>,
}

/// One structured log line emitted during task execution.
#[derive(Debug, Clone)]
pub struct TaskLogEntry {
    pub id: String,
    pub job_id: String,
    pub task_name: String,
    pub level: String,
    pub message: String,
    pub extra: Option<String>,
    pub logged_at: i64,
}

/// Persisted circuit-breaker state for a task.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CircuitBreakerState {
    pub task_name: String,
    pub state: i32,
    pub failure_count: i32,
    pub last_failure_at: Option<i64>,
    pub opened_at: Option<i64>,
    pub half_open_at: Option<i64>,
    pub threshold: i32,
    pub window_ms: i64,
    pub cooldown_ms: i64,
    #[serde(default = "default_max_probes")]
    pub half_open_max_probes: i32,
    #[serde(default = "default_success_rate")]
    pub half_open_success_rate: f64,
    #[serde(default)]
    pub half_open_probe_count: i32,
    #[serde(default)]
    pub half_open_success_count: i32,
    #[serde(default)]
    pub half_open_failure_count: i32,
}

fn default_max_probes() -> i32 {
    5
}

fn default_success_rate() -> f64 {
    0.8
}

/// A registered worker as seen by the cluster registry.
#[derive(Debug, Clone)]
pub struct WorkerInfo {
    pub worker_id: String,
    pub last_heartbeat: i64,
    pub queues: String,
    pub status: String,
    pub tags: Option<String>,
    pub resources: Option<String>,
    pub resource_health: Option<String>,
    pub threads: i32,
    pub started_at: Option<i64>,
    pub hostname: Option<String>,
    pub pid: Option<i32>,
    pub pool_type: Option<String>,
}

/// Holder and expiry of a distributed lock.
#[derive(Debug, Clone)]
pub struct LockInfo {
    pub lock_name: String,
    pub owner_id: String,
    pub acquired_at: i64,
    pub expires_at: i64,
}
