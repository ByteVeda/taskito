//! Serde views marshalled across the JNI boundary as JSON.
//!
//! Option and filter structs cross as JSON strings (decoded here); opaque job
//! payloads cross as raw `byte[]` and are never interpreted by the core.

use serde::{Deserialize, Serialize};
use taskito_core::job::{now_millis, Job, NewJob};
use taskito_core::storage::models::{
    JobErrorRow, LockInfoRow, PeriodicTaskRow, TaskLogRow, TaskMetricRow, WorkerRow,
};
use taskito_core::storage::{DeadJob, QueueStats};

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
        // Saturate rather than wrap/panic on an absurd delay.
        scheduled_at: now_millis().saturating_add(delay),
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
    /// Opaque metadata blob (JSON the SDK sets, e.g. middleware-injected trace ids).
    pub metadata: Option<&'a str>,
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
            metadata: j.metadata.as_deref(),
        }
    }
}

/// Options accepted by `NativeQueue.runWorker`.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct WorkerOptions {
    pub queues: Option<Vec<String>>,
    pub channel_capacity: Option<u32>,
    pub batch_size: Option<u32>,
    /// Per-task retry-backoff policies, registered with the scheduler at start.
    /// The core owns the retry engine; this only feeds it the backoff curve.
    pub task_configs: Option<Vec<TaskRetryConfig>>,
}

/// A task's retry-backoff curve. Fields left unset fall back to the core's
/// `RetryPolicy` defaults; the per-job retry budget travels via `maxRetries` on
/// enqueue, so it is deliberately absent here.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRetryConfig {
    pub name: String,
    pub base_delay_ms: Option<i64>,
    pub max_delay_ms: Option<i64>,
    pub custom_delays_ms: Option<Vec<i64>>,
}

/// Filter accepted by `NativeQueue.listJobs`.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct JobFilter {
    pub status: Option<String>,
    pub queue: Option<String>,
    pub task: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

/// Map a lowercase status string to the core's `i32` status code.
pub fn status_code(status: &str) -> Option<i32> {
    match status {
        "pending" => Some(0),
        "running" => Some(1),
        "complete" | "completed" => Some(2),
        "failed" => Some(3),
        "dead" => Some(4),
        "cancelled" => Some(5),
        _ => None,
    }
}

/// Periodic-task view (omits the opaque args/kwargs payloads).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeriodicTaskView<'a> {
    pub name: &'a str,
    pub task_name: &'a str,
    pub cron_expr: &'a str,
    pub queue: &'a str,
    pub enabled: bool,
    pub last_run: Option<i64>,
    pub next_run: i64,
    pub timezone: Option<&'a str>,
}

impl<'a> From<&'a PeriodicTaskRow> for PeriodicTaskView<'a> {
    fn from(p: &'a PeriodicTaskRow) -> Self {
        Self {
            name: &p.name,
            task_name: &p.task_name,
            cron_expr: &p.cron_expr,
            queue: &p.queue,
            enabled: p.enabled,
            last_run: p.last_run,
            next_run: p.next_run,
            timezone: p.timezone.as_deref(),
        }
    }
}

/// Dead-letter entry view (omits the opaque payload).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeadJobView<'a> {
    pub id: &'a str,
    pub original_job_id: &'a str,
    pub queue: &'a str,
    pub task_name: &'a str,
    pub error: Option<&'a str>,
    pub retry_count: i32,
    pub failed_at: i64,
    pub metadata: Option<&'a str>,
    pub dlq_retry_count: i32,
}

impl<'a> From<&'a DeadJob> for DeadJobView<'a> {
    fn from(d: &'a DeadJob) -> Self {
        Self {
            id: &d.id,
            original_job_id: &d.original_job_id,
            queue: &d.queue,
            task_name: &d.task_name,
            error: d.error.as_deref(),
            retry_count: d.retry_count,
            failed_at: d.failed_at,
            metadata: d.metadata.as_deref(),
            dlq_retry_count: d.dlq_retry_count,
        }
    }
}

/// One recorded error attempt for a job.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobErrorView<'a> {
    pub id: &'a str,
    pub job_id: &'a str,
    pub attempt: i32,
    pub error: &'a str,
    pub failed_at: i64,
}

impl<'a> From<&'a JobErrorRow> for JobErrorView<'a> {
    fn from(e: &'a JobErrorRow) -> Self {
        Self {
            id: &e.id,
            job_id: &e.job_id,
            attempt: e.attempt,
            error: &e.error,
            failed_at: e.failed_at,
        }
    }
}

/// A per-execution task metric.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricView<'a> {
    pub task_name: &'a str,
    pub job_id: &'a str,
    pub wall_time_ns: i64,
    pub memory_bytes: i64,
    pub succeeded: bool,
    pub recorded_at: i64,
}

impl<'a> From<&'a TaskMetricRow> for MetricView<'a> {
    fn from(m: &'a TaskMetricRow) -> Self {
        Self {
            task_name: &m.task_name,
            job_id: &m.job_id,
            wall_time_ns: m.wall_time_ns,
            memory_bytes: m.memory_bytes,
            succeeded: m.succeeded,
            recorded_at: m.recorded_at,
        }
    }
}

/// A registered worker (heartbeat + identity).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerView<'a> {
    pub worker_id: &'a str,
    pub queues: &'a str,
    pub status: &'a str,
    pub last_heartbeat: i64,
    pub started_at: Option<i64>,
    pub hostname: Option<&'a str>,
    pub pid: Option<i32>,
    pub pool_type: Option<&'a str>,
    pub threads: i32,
    pub tags: Option<&'a str>,
}

impl<'a> From<&'a WorkerRow> for WorkerView<'a> {
    fn from(w: &'a WorkerRow) -> Self {
        Self {
            worker_id: &w.worker_id,
            queues: &w.queues,
            status: &w.status,
            last_heartbeat: w.last_heartbeat,
            started_at: w.started_at,
            hostname: w.hostname.as_deref(),
            pid: w.pid,
            pool_type: w.pool_type.as_deref(),
            threads: w.threads,
            tags: w.tags.as_deref(),
        }
    }
}

/// A task log line.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogView<'a> {
    pub id: &'a str,
    pub job_id: &'a str,
    pub task_name: &'a str,
    pub level: &'a str,
    pub message: &'a str,
    pub extra: Option<&'a str>,
    pub logged_at: i64,
}

impl<'a> From<&'a TaskLogRow> for LogView<'a> {
    fn from(l: &'a TaskLogRow) -> Self {
        Self {
            id: &l.id,
            job_id: &l.job_id,
            task_name: &l.task_name,
            level: &l.level,
            message: &l.message,
            extra: l.extra.as_deref(),
            logged_at: l.logged_at,
        }
    }
}

/// Current holder of a distributed lock.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LockInfoView<'a> {
    pub lock_name: &'a str,
    pub owner_id: &'a str,
    pub acquired_at: i64,
    pub expires_at: i64,
}

impl<'a> From<&'a LockInfoRow> for LockInfoView<'a> {
    fn from(l: &'a LockInfoRow) -> Self {
        Self {
            lock_name: &l.lock_name,
            owner_id: &l.owner_id,
            acquired_at: l.acquired_at,
            expires_at: l.expires_at,
        }
    }
}

/// Serialize a view to a JSON string for return across the boundary.
pub fn to_json<T: Serialize>(value: &T) -> Result<String, BindingError> {
    serde_json::to_string(value).map_err(|e| BindingError::new(format!("serialize failed: {e}")))
}
