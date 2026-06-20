//! Plain option objects passed from JavaScript. napi maps snake_case Rust
//! fields to camelCase JS keys (`maxRetries`, `timeoutMs`).

use napi_derive::napi;

/// How to open a queue's storage backend.
#[napi(object)]
pub struct OpenOptions {
    /// `"sqlite"` (default), `"postgres"`, or `"redis"`. The latter two require
    /// the addon to be built with the matching cargo feature.
    pub backend: Option<String>,
    /// SQLite file path, Postgres URL, or Redis URL.
    pub dsn: String,
    /// Connection pool size (SQLite/Postgres).
    pub pool_size: Option<u32>,
    /// Postgres schema (default `"taskito"`).
    pub schema: Option<String>,
    /// Redis key prefix.
    pub prefix: Option<String>,
    /// Optional namespace applied to enqueued jobs and the worker scheduler.
    pub namespace: Option<String>,
}

/// Per-enqueue overrides. All optional — omitted fields fall back to defaults
/// in [`crate::convert::build_new_job`].
#[napi(object)]
#[derive(Default)]
pub struct EnqueueOptions {
    pub queue: Option<String>,
    pub priority: Option<i32>,
    pub max_retries: Option<i32>,
    pub timeout_ms: Option<i64>,
    /// Run no earlier than `now + delayMs` (delayed/scheduled job).
    pub delay_ms: Option<i64>,
    /// Dedup key — a second enqueue with the same key is a no-op while the
    /// first is pending/running (idempotency).
    pub unique_key: Option<String>,
    /// Free-form metadata string stored with the job.
    pub metadata: Option<String>,
    /// Namespace override for this job.
    pub namespace: Option<String>,
}

/// Per-task configuration registered on the scheduler before the worker runs.
#[napi(object)]
pub struct TaskConfigInput {
    pub name: String,
    pub max_retries: Option<i32>,
    pub retry_base_delay_ms: Option<i64>,
    pub retry_max_delay_ms: Option<i64>,
    pub max_concurrent: Option<i32>,
    /// Rate-limit spec like `"100/m"`, `"50/s"`, `"3600/h"`.
    pub rate_limit: Option<String>,
}

/// Per-queue configuration registered on the scheduler before the worker runs.
#[napi(object)]
pub struct QueueConfigInput {
    pub name: String,
    pub max_concurrent: Option<i32>,
    pub rate_limit: Option<String>,
}

/// Options for a running worker. `queues` defaults to `["default"]`.
#[napi(object)]
#[derive(Default)]
pub struct WorkerOptions {
    pub queues: Option<Vec<String>>,
    pub channel_capacity: Option<u32>,
    /// Jobs claimed per scheduler poll (default 1).
    pub batch_size: Option<u32>,
    pub task_configs: Option<Vec<TaskConfigInput>>,
    pub queue_configs: Option<Vec<QueueConfigInput>>,
}
