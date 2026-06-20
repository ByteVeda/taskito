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

/// Filter for [`crate::queue::JsQueue::list_jobs`]. All fields optional.
#[napi(object)]
#[derive(Default)]
pub struct JobFilter {
    /// Lowercase status (`"pending"`, `"running"`, `"complete"`, `"failed"`, `"dead"`, `"cancelled"`).
    pub status: Option<String>,
    pub queue: Option<String>,
    pub task: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

/// Circuit-breaker config for a task: trip after `threshold` failures within
/// `windowMs`, stay open for `cooldownMs`, then probe before fully closing.
#[napi(object)]
pub struct CircuitBreakerInput {
    pub threshold: i32,
    pub window_ms: i64,
    pub cooldown_ms: i64,
    /// Probe requests allowed while half-open (default 5).
    pub half_open_max_probes: Option<i32>,
    /// Success rate (0.0–1.0) required to close from half-open (default 0.8).
    pub half_open_success_rate: Option<f64>,
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
    pub circuit_breaker: Option<CircuitBreakerInput>,
}

/// Per-queue configuration registered on the scheduler before the worker runs.
#[napi(object)]
pub struct QueueConfigInput {
    pub name: String,
    pub max_concurrent: Option<i32>,
    pub rate_limit: Option<String>,
}

/// Opt-in mesh overlay for a worker: decentralized peer discovery (SWIM gossip)
/// plus work-stealing across nodes. Ignored unless the addon is built with the
/// `mesh` cargo feature. The DB stays the source of truth — mesh only optimizes
/// dispatch locality.
#[napi(object)]
pub struct MeshWorkerConfig {
    /// UDP gossip port. The TCP work-stealing server binds `port + 1`.
    pub port: u32,
    /// Bind address for both servers (default `"0.0.0.0"`).
    pub bind_addr: Option<String>,
    /// Seed peers to join, as `"host:gossip_port"` strings.
    pub seeds: Option<Vec<String>>,
    /// Enable work-stealing from busier peers (default true).
    pub steal: Option<bool>,
    /// Affinity weight for consistent-hash placement (default from core).
    pub affinity_weight: Option<f64>,
    /// Local deque capacity before back-pressure.
    pub local_buffer: Option<u32>,
    /// Max jobs pulled in one steal.
    pub steal_batch: Option<u32>,
    /// Deque depth at or below which this node tries to steal.
    pub steal_threshold: Option<u32>,
    /// Virtual nodes per peer on the hash ring.
    pub virtual_nodes: Option<u32>,
    /// Address advertised to peers when behind NAT (`"host:port"`).
    pub advertise_addr: Option<String>,
    /// Shared key enabling XOR gossip encryption (must match across the mesh).
    pub encryption_key: Option<String>,
    /// Per-peer steal rate limit (steals per second).
    pub steal_rate_limit: Option<u32>,
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
    /// Opt-in decentralized mesh overlay (requires the `mesh` build feature).
    pub mesh: Option<MeshWorkerConfig>,
}
