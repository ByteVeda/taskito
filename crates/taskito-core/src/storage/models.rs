use diesel::prelude::*;
use serde::{Deserialize, Serialize};

use super::schema::{
    archived_jobs, circuit_breakers, dead_letter, distributed_locks, execution_claims,
    job_dependencies, job_errors, jobs, periodic_tasks, queue_state, rate_limits, replay_history,
    task_logs, task_metrics, workers,
};

/// A row in the `jobs` table (for SELECT queries).
#[derive(Queryable, Selectable, Debug, Clone)]
#[diesel(table_name = jobs)]
pub struct JobRow {
    pub id: String,
    pub queue: String,
    pub task_name: String,
    pub payload: Vec<u8>,
    pub status: i32,
    pub priority: i32,
    pub created_at: i64,
    pub scheduled_at: i64,
    pub started_at: Option<i64>,
    pub completed_at: Option<i64>,
    pub retry_count: i32,
    pub max_retries: i32,
    pub result: Option<Vec<u8>>,
    pub error: Option<String>,
    pub timeout_ms: i64,
    pub unique_key: Option<String>,
    pub progress: Option<i32>,
    pub metadata: Option<String>,
    pub cancel_requested: i32,
    pub expires_at: Option<i64>,
    pub result_ttl_ms: Option<i64>,
    pub namespace: Option<String>,
}

/// Insertable struct for creating new jobs.
#[derive(Insertable, Debug)]
#[diesel(table_name = jobs)]
pub struct NewJobRow<'a> {
    pub id: &'a str,
    pub queue: &'a str,
    pub task_name: &'a str,
    pub payload: &'a [u8],
    pub status: i32,
    pub priority: i32,
    pub created_at: i64,
    pub scheduled_at: i64,
    pub retry_count: i32,
    pub max_retries: i32,
    pub timeout_ms: i64,
    pub unique_key: Option<&'a str>,
    pub metadata: Option<&'a str>,
    pub cancel_requested: i32,
    pub expires_at: Option<i64>,
    pub result_ttl_ms: Option<i64>,
    pub namespace: Option<&'a str>,
}

/// A row in the `dead_letter` table.
#[derive(Queryable, Selectable, Debug, Clone)]
#[diesel(table_name = dead_letter)]
pub struct DeadLetterRow {
    pub id: String,
    pub original_job_id: String,
    pub queue: String,
    pub task_name: String,
    pub payload: Vec<u8>,
    pub error: Option<String>,
    pub retry_count: i32,
    pub failed_at: i64,
    pub metadata: Option<String>,
    pub priority: i32,
    pub max_retries: i32,
    pub timeout_ms: i64,
    pub result_ttl_ms: Option<i64>,
}

/// Insertable struct for dead letter entries.
#[derive(Insertable, Debug)]
#[diesel(table_name = dead_letter)]
pub struct NewDeadLetterRow<'a> {
    pub id: &'a str,
    pub original_job_id: &'a str,
    pub queue: &'a str,
    pub task_name: &'a str,
    pub payload: &'a [u8],
    pub error: Option<&'a str>,
    pub retry_count: i32,
    pub failed_at: i64,
    pub metadata: Option<&'a str>,
    pub priority: i32,
    pub max_retries: i32,
    pub timeout_ms: i64,
    pub result_ttl_ms: Option<i64>,
}

/// A row in the `rate_limits` table.
#[derive(Queryable, Selectable, Insertable, AsChangeset, Debug, Clone, Serialize, Deserialize)]
#[diesel(table_name = rate_limits)]
pub struct RateLimitRow {
    pub key: String,
    pub tokens: f64,
    pub max_tokens: f64,
    pub refill_rate: f64,
    pub last_refill: i64,
}

/// A row in the `periodic_tasks` table.
#[derive(Queryable, Selectable, Debug, Clone)]
#[diesel(table_name = periodic_tasks)]
pub struct PeriodicTaskRow {
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

/// Insertable struct for periodic tasks.
#[derive(Insertable, AsChangeset, Debug)]
#[diesel(table_name = periodic_tasks)]
pub struct NewPeriodicTaskRow<'a> {
    pub name: &'a str,
    pub task_name: &'a str,
    pub cron_expr: &'a str,
    pub args: Option<&'a [u8]>,
    pub kwargs: Option<&'a [u8]>,
    pub queue: &'a str,
    pub enabled: bool,
    pub next_run: i64,
    pub timezone: Option<&'a str>,
}

/// A row in the `job_errors` table (for SELECT queries).
#[derive(Queryable, Selectable, Debug, Clone, Serialize, Deserialize)]
#[diesel(table_name = job_errors)]
pub struct JobErrorRow {
    pub id: String,
    pub job_id: String,
    pub attempt: i32,
    pub error: String,
    pub failed_at: i64,
}

/// Insertable struct for job error entries.
#[derive(Insertable, Debug)]
#[diesel(table_name = job_errors)]
pub struct NewJobErrorRow<'a> {
    pub id: &'a str,
    pub job_id: &'a str,
    pub attempt: i32,
    pub error: &'a str,
    pub failed_at: i64,
}

/// A row in the `job_dependencies` table.
#[derive(Queryable, Selectable, Debug, Clone)]
#[diesel(table_name = job_dependencies)]
pub struct JobDependencyRow {
    pub id: String,
    pub job_id: String,
    pub depends_on_job_id: String,
}

/// Insertable struct for job dependency entries.
#[derive(Insertable, Debug)]
#[diesel(table_name = job_dependencies)]
pub struct NewJobDependencyRow<'a> {
    pub id: &'a str,
    pub job_id: &'a str,
    pub depends_on_job_id: &'a str,
}

// ── Task Metrics ─────────────────────────────────────────────────

#[derive(Queryable, Selectable, Debug, Clone)]
#[diesel(table_name = task_metrics)]
pub struct TaskMetricRow {
    pub id: String,
    pub task_name: String,
    pub job_id: String,
    pub wall_time_ns: i64,
    pub memory_bytes: i64,
    pub succeeded: bool,
    pub recorded_at: i64,
}

#[derive(Insertable, Debug)]
#[diesel(table_name = task_metrics)]
pub struct NewTaskMetricRow<'a> {
    pub id: &'a str,
    pub task_name: &'a str,
    pub job_id: &'a str,
    pub wall_time_ns: i64,
    pub memory_bytes: i64,
    pub succeeded: bool,
    pub recorded_at: i64,
}

// ── Replay History ───────────────────────────────────────────────

#[derive(Queryable, Selectable, Debug, Clone)]
#[diesel(table_name = replay_history)]
pub struct ReplayHistoryRow {
    pub id: String,
    pub original_job_id: String,
    pub replay_job_id: String,
    pub replayed_at: i64,
    pub original_result: Option<Vec<u8>>,
    pub replay_result: Option<Vec<u8>>,
    pub original_error: Option<String>,
    pub replay_error: Option<String>,
}

#[derive(Insertable, Debug)]
#[diesel(table_name = replay_history)]
pub struct NewReplayHistoryRow<'a> {
    pub id: &'a str,
    pub original_job_id: &'a str,
    pub replay_job_id: &'a str,
    pub replayed_at: i64,
    pub original_result: Option<&'a [u8]>,
    pub replay_result: Option<&'a [u8]>,
    pub original_error: Option<&'a str>,
    pub replay_error: Option<&'a str>,
}

// ── Task Logs ────────────────────────────────────────────────────

#[derive(Queryable, Selectable, Debug, Clone)]
#[diesel(table_name = task_logs)]
pub struct TaskLogRow {
    pub id: String,
    pub job_id: String,
    pub task_name: String,
    pub level: String,
    pub message: String,
    pub extra: Option<String>,
    pub logged_at: i64,
}

#[derive(Insertable, Debug)]
#[diesel(table_name = task_logs)]
pub struct NewTaskLogRow<'a> {
    pub id: &'a str,
    pub job_id: &'a str,
    pub task_name: &'a str,
    pub level: &'a str,
    pub message: &'a str,
    pub extra: Option<&'a str>,
    pub logged_at: i64,
}

// ── Circuit Breaker ──────────────────────────────────────────────

#[derive(Queryable, Selectable, Insertable, AsChangeset, Debug, Clone, Serialize, Deserialize)]
#[diesel(table_name = circuit_breakers)]
pub struct CircuitBreakerRow {
    pub task_name: String,
    pub state: i32,
    pub failure_count: i32,
    pub last_failure_at: Option<i64>,
    pub opened_at: Option<i64>,
    pub half_open_at: Option<i64>,
    pub threshold: i32,
    pub window_ms: i64,
    pub cooldown_ms: i64,
}

// ── Workers ──────────────────────────────────────────────────────

#[derive(Queryable, Selectable, Debug, Clone)]
#[diesel(table_name = workers)]
pub struct WorkerRow {
    pub worker_id: String,
    pub last_heartbeat: i64,
    pub queues: String,
    pub status: String,
    pub tags: Option<String>,
    pub resources: Option<String>,
    pub resource_health: Option<String>,
    pub threads: i32,
}

#[derive(Insertable, AsChangeset, Debug)]
#[diesel(table_name = workers)]
pub struct NewWorkerRow<'a> {
    pub worker_id: &'a str,
    pub last_heartbeat: i64,
    pub queues: &'a str,
    pub status: &'a str,
    pub tags: Option<&'a str>,
    pub resources: Option<&'a str>,
    pub resource_health: Option<&'a str>,
    pub threads: i32,
}

// ── Queue State ─────────────────────────────────────────────────

#[derive(Queryable, Selectable, Insertable, AsChangeset, Debug, Clone)]
#[diesel(table_name = queue_state)]
pub struct QueueStateRow {
    pub queue_name: String,
    pub paused: bool,
    pub paused_at: Option<i64>,
}

// ── Distributed Locks ───────────────────────────────────────────

#[derive(Queryable, Selectable, QueryableByName, Debug, Clone)]
#[diesel(table_name = distributed_locks)]
pub struct LockInfoRow {
    pub lock_name: String,
    pub owner_id: String,
    pub acquired_at: i64,
    pub expires_at: i64,
}

#[derive(Insertable, Debug)]
#[diesel(table_name = distributed_locks)]
pub struct NewLockRow<'a> {
    pub lock_name: &'a str,
    pub owner_id: &'a str,
    pub acquired_at: i64,
    pub expires_at: i64,
}

// ── Execution Claims ────────────────────────────────────────────

#[derive(Queryable, Selectable, Debug, Clone)]
#[diesel(table_name = execution_claims)]
pub struct ExecutionClaimRow {
    pub job_id: String,
    pub worker_id: String,
    pub claimed_at: i64,
}

#[derive(Insertable, Debug)]
#[diesel(table_name = execution_claims)]
pub struct NewExecutionClaimRow<'a> {
    pub job_id: &'a str,
    pub worker_id: &'a str,
    pub claimed_at: i64,
}

// ── Archived Jobs ───────────────────────────────────────────────

#[derive(Queryable, Selectable, Debug, Clone)]
#[diesel(table_name = archived_jobs)]
pub struct ArchivedJobRow {
    pub id: String,
    pub queue: String,
    pub task_name: String,
    pub payload: Vec<u8>,
    pub status: i32,
    pub priority: i32,
    pub created_at: i64,
    pub scheduled_at: i64,
    pub started_at: Option<i64>,
    pub completed_at: Option<i64>,
    pub retry_count: i32,
    pub max_retries: i32,
    pub result: Option<Vec<u8>>,
    pub error: Option<String>,
    pub timeout_ms: i64,
    pub unique_key: Option<String>,
    pub progress: Option<i32>,
    pub metadata: Option<String>,
    pub cancel_requested: i32,
    pub expires_at: Option<i64>,
    pub result_ttl_ms: Option<i64>,
}
