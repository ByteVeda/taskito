//! Serde views marshalled across the JNI boundary as JSON.
//!
//! Option and filter structs cross as JSON strings (decoded here); opaque job
//! payloads cross as raw `byte[]` and are never interpreted by the core.

use serde::{Deserialize, Serialize};
use taskito_core::job::{now_millis, Job, NewJob};
use taskito_core::storage::QueueStats;

use crate::error::BindingError;

const DEFAULT_QUEUE: &str = "default";

/// Options accepted by `NativeQueue.open`.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenOptions {
    pub backend: Option<String>,
    pub dsn: String,
    pub pool_size: Option<u32>,
    /// Postgres schema; read only by the `postgres` backend.
    #[cfg_attr(not(feature = "postgres"), allow(dead_code))]
    pub schema: Option<String>,
    /// Redis key prefix; read only by the `redis` backend.
    #[cfg_attr(not(feature = "redis"), allow(dead_code))]
    pub prefix: Option<String>,
    pub namespace: Option<String>,
}

/// Per-enqueue options. Every field is optional; absent fields take core
/// defaults.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct EnqueueOptions {
    pub queue: Option<String>,
    pub priority: Option<i32>,
    pub max_retries: Option<i32>,
    pub timeout_ms: Option<i64>,
    pub delay_ms: Option<i64>,
    pub unique_key: Option<String>,
    pub metadata: Option<String>,
    pub namespace: Option<String>,
}

/// Parse a JSON argument, attributing any failure to the named field.
pub fn parse_json<'a, T: Deserialize<'a>>(raw: &'a str, what: &str) -> Result<T, BindingError> {
    serde_json::from_str(raw).map_err(|e| BindingError::new(format!("invalid {what} JSON: {e}")))
}

/// Build a [`NewJob`] from an enqueue request, applying the queue's default
/// namespace when the request does not set one.
pub fn build_new_job(
    task_name: String,
    payload: Vec<u8>,
    options: EnqueueOptions,
    default_namespace: Option<&str>,
) -> NewJob {
    let delay = options.delay_ms.unwrap_or(0).max(0);
    NewJob {
        queue: options.queue.unwrap_or_else(|| DEFAULT_QUEUE.to_string()),
        task_name,
        payload,
        priority: options.priority.unwrap_or(0),
        scheduled_at: now_millis() + delay,
        max_retries: options.max_retries.unwrap_or(0),
        timeout_ms: options.timeout_ms.unwrap_or(0),
        unique_key: options.unique_key,
        metadata: options.metadata,
        notes: None,
        depends_on: Vec::new(),
        expires_at: None,
        result_ttl_ms: None,
        namespace: options
            .namespace
            .or_else(|| default_namespace.map(str::to_string)),
    }
}

/// Job-count snapshot returned by `NativeQueue.stats`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsView {
    pub pending: i64,
    pub running: i64,
    pub completed: i64,
    pub failed: i64,
    pub dead: i64,
    pub cancelled: i64,
}

impl From<QueueStats> for StatsView {
    fn from(s: QueueStats) -> Self {
        Self {
            pending: s.pending,
            running: s.running,
            completed: s.completed,
            failed: s.failed,
            dead: s.dead,
            cancelled: s.cancelled,
        }
    }
}

/// Java-facing view of a job. Omits the opaque `payload`/`result` blobs; the
/// Java side deserializes those itself. `status` is the lowercase wire string
/// shared across SDKs. Timestamps are Unix milliseconds.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobView<'a> {
    pub id: &'a str,
    pub queue: &'a str,
    pub task_name: &'a str,
    pub status: &'static str,
    pub priority: i32,
    pub created_at: i64,
    pub scheduled_at: i64,
    pub started_at: Option<i64>,
    pub completed_at: Option<i64>,
    pub retry_count: i32,
    pub max_retries: i32,
    pub timeout_ms: i64,
    pub progress: Option<i32>,
    pub error: Option<&'a str>,
    pub unique_key: Option<&'a str>,
    pub namespace: Option<&'a str>,
}

impl<'a> From<&'a Job> for JobView<'a> {
    fn from(j: &'a Job) -> Self {
        Self {
            id: &j.id,
            queue: &j.queue,
            task_name: &j.task_name,
            status: j.status.as_str(),
            priority: j.priority,
            created_at: j.created_at,
            scheduled_at: j.scheduled_at,
            started_at: j.started_at,
            completed_at: j.completed_at,
            retry_count: j.retry_count,
            max_retries: j.max_retries,
            timeout_ms: j.timeout_ms,
            progress: j.progress,
            error: j.error.as_deref(),
            unique_key: j.unique_key.as_deref(),
            namespace: j.namespace.as_deref(),
        }
    }
}

/// Serialize a view to a JSON string for return across the boundary.
pub fn to_json<T: Serialize>(value: &T) -> Result<String, BindingError> {
    serde_json::to_string(value).map_err(|e| BindingError::new(format!("serialize failed: {e}")))
}
