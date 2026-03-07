pub mod models;
pub mod postgres;
pub mod schema;
pub mod sqlite;
pub mod traits;

pub use traits::Storage;

use crate::error::Result;
use crate::job::{Job, NewJob};

// ── Shared helper types ────────────────────────────────────────────────

#[derive(Debug, Clone, Default)]
pub struct QueueStats {
    pub pending: i64,
    pub running: i64,
    pub completed: i64,
    pub failed: i64,
    pub dead: i64,
    pub cancelled: i64,
}

#[derive(Debug, Clone)]
pub struct DeadJob {
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

impl From<models::DeadLetterRow> for DeadJob {
    fn from(row: models::DeadLetterRow) -> Self {
        Self {
            id: row.id,
            original_job_id: row.original_job_id,
            queue: row.queue,
            task_name: row.task_name,
            payload: row.payload,
            error: row.error,
            retry_count: row.retry_count,
            failed_at: row.failed_at,
            metadata: row.metadata,
            priority: row.priority,
            max_retries: row.max_retries,
            timeout_ms: row.timeout_ms,
            result_ttl_ms: row.result_ttl_ms,
        }
    }
}

// ── Backend-agnostic storage wrapper ──────────────────────────────────

/// Storage backend enum that dispatches to either SQLite or PostgreSQL.
#[derive(Clone)]
pub enum StorageBackend {
    Sqlite(sqlite::SqliteStorage),
    Postgres(postgres::PostgresStorage),
}

macro_rules! delegate {
    ($self:expr, $method:ident $(, $arg:expr)*) => {
        match $self {
            StorageBackend::Sqlite(s) => s.$method($($arg),*),
            StorageBackend::Postgres(s) => s.$method($($arg),*),
        }
    };
}

impl Storage for StorageBackend {
    fn enqueue(&self, new_job: NewJob) -> Result<Job> {
        delegate!(self, enqueue, new_job)
    }
    fn enqueue_batch(&self, new_jobs: Vec<NewJob>) -> Result<Vec<Job>> {
        delegate!(self, enqueue_batch, new_jobs)
    }
    fn enqueue_unique(&self, new_job: NewJob) -> Result<Job> {
        delegate!(self, enqueue_unique, new_job)
    }
    fn dequeue(&self, queue_name: &str, now: i64) -> Result<Option<Job>> {
        delegate!(self, dequeue, queue_name, now)
    }
    fn dequeue_from(&self, queues: &[String], now: i64) -> Result<Option<Job>> {
        delegate!(self, dequeue_from, queues, now)
    }
    fn complete(&self, id: &str, result_bytes: Option<Vec<u8>>) -> Result<()> {
        delegate!(self, complete, id, result_bytes)
    }
    fn fail(&self, id: &str, error: &str) -> Result<()> {
        delegate!(self, fail, id, error)
    }
    fn retry(&self, id: &str, next_scheduled_at: i64) -> Result<()> {
        delegate!(self, retry, id, next_scheduled_at)
    }
    fn cancel_job(&self, id: &str) -> Result<bool> {
        delegate!(self, cancel_job, id)
    }
    fn request_cancel(&self, id: &str) -> Result<bool> {
        delegate!(self, request_cancel, id)
    }
    fn is_cancel_requested(&self, id: &str) -> Result<bool> {
        delegate!(self, is_cancel_requested, id)
    }
    fn mark_cancelled(&self, id: &str) -> Result<()> {
        delegate!(self, mark_cancelled, id)
    }
    fn cascade_cancel(&self, failed_job_id: &str, reason: &str) -> Result<()> {
        delegate!(self, cascade_cancel, failed_job_id, reason)
    }
    fn get_dependencies(&self, job_id: &str) -> Result<Vec<String>> {
        delegate!(self, get_dependencies, job_id)
    }
    fn get_dependents(&self, job_id: &str) -> Result<Vec<String>> {
        delegate!(self, get_dependents, job_id)
    }
    fn update_progress(&self, id: &str, progress: i32) -> Result<()> {
        delegate!(self, update_progress, id, progress)
    }
    fn list_jobs(
        &self,
        status: Option<i32>,
        queue_name: Option<&str>,
        task_name: Option<&str>,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<Job>> {
        delegate!(self, list_jobs, status, queue_name, task_name, limit, offset)
    }
    fn get_job(&self, id: &str) -> Result<Option<Job>> {
        delegate!(self, get_job, id)
    }
    fn stats(&self) -> Result<QueueStats> {
        delegate!(self, stats)
    }
    fn purge_completed(&self, older_than_ms: i64) -> Result<u64> {
        delegate!(self, purge_completed, older_than_ms)
    }
    fn purge_completed_with_ttl(&self, global_cutoff_ms: i64) -> Result<u64> {
        delegate!(self, purge_completed_with_ttl, global_cutoff_ms)
    }
    fn reap_stale_jobs(&self, now: i64) -> Result<Vec<Job>> {
        delegate!(self, reap_stale_jobs, now)
    }
    fn record_error(&self, job_id: &str, attempt: i32, error: &str) -> Result<()> {
        delegate!(self, record_error, job_id, attempt, error)
    }
    fn get_job_errors(&self, job_id: &str) -> Result<Vec<models::JobErrorRow>> {
        delegate!(self, get_job_errors, job_id)
    }
    fn purge_job_errors(&self, older_than_ms: i64) -> Result<u64> {
        delegate!(self, purge_job_errors, older_than_ms)
    }
    fn move_to_dlq(&self, job: &Job, error: &str, metadata: Option<&str>) -> Result<()> {
        delegate!(self, move_to_dlq, job, error, metadata)
    }
    fn list_dead(&self, limit: i64, offset: i64) -> Result<Vec<DeadJob>> {
        delegate!(self, list_dead, limit, offset)
    }
    fn retry_dead(&self, dead_id: &str) -> Result<String> {
        delegate!(self, retry_dead, dead_id)
    }
    fn purge_dead(&self, older_than_ms: i64) -> Result<u64> {
        delegate!(self, purge_dead, older_than_ms)
    }
    fn get_rate_limit(&self, key: &str) -> Result<Option<models::RateLimitRow>> {
        delegate!(self, get_rate_limit, key)
    }
    fn upsert_rate_limit(&self, row: &models::RateLimitRow) -> Result<()> {
        delegate!(self, upsert_rate_limit, row)
    }
    fn try_acquire_token(&self, key: &str, max_tokens: f64, refill_rate: f64) -> Result<bool> {
        delegate!(self, try_acquire_token, key, max_tokens, refill_rate)
    }
    fn register_periodic(&self, task: &models::NewPeriodicTaskRow) -> Result<()> {
        delegate!(self, register_periodic, task)
    }
    fn get_due_periodic(&self, now: i64) -> Result<Vec<models::PeriodicTaskRow>> {
        delegate!(self, get_due_periodic, now)
    }
    fn update_periodic_schedule(&self, name: &str, last_run: i64, next_run: i64) -> Result<()> {
        delegate!(self, update_periodic_schedule, name, last_run, next_run)
    }
    fn record_metric(
        &self,
        task_name: &str,
        job_id: &str,
        wall_time_ns: i64,
        memory_bytes: i64,
        succeeded: bool,
    ) -> Result<()> {
        delegate!(
            self,
            record_metric,
            task_name,
            job_id,
            wall_time_ns,
            memory_bytes,
            succeeded
        )
    }
    fn get_metrics(&self, name: Option<&str>, since_ms: i64) -> Result<Vec<models::TaskMetricRow>> {
        delegate!(self, get_metrics, name, since_ms)
    }
    fn purge_metrics(&self, older_than_ms: i64) -> Result<u64> {
        delegate!(self, purge_metrics, older_than_ms)
    }
    fn record_replay(
        &self,
        original_job_id: &str,
        replay_job_id: &str,
        original_result: Option<&[u8]>,
        replay_result: Option<&[u8]>,
        original_error: Option<&str>,
        replay_error: Option<&str>,
    ) -> Result<()> {
        delegate!(
            self,
            record_replay,
            original_job_id,
            replay_job_id,
            original_result,
            replay_result,
            original_error,
            replay_error
        )
    }
    fn get_replay_history(&self, original_job_id: &str) -> Result<Vec<models::ReplayHistoryRow>> {
        delegate!(self, get_replay_history, original_job_id)
    }
    fn write_task_log(
        &self,
        job_id: &str,
        task_name: &str,
        level: &str,
        message: &str,
        extra: Option<&str>,
    ) -> Result<()> {
        delegate!(
            self,
            write_task_log,
            job_id,
            task_name,
            level,
            message,
            extra
        )
    }
    fn get_task_logs(&self, job_id: &str) -> Result<Vec<models::TaskLogRow>> {
        delegate!(self, get_task_logs, job_id)
    }
    fn query_task_logs(
        &self,
        task_name: Option<&str>,
        level: Option<&str>,
        since_ms: i64,
        limit: i64,
    ) -> Result<Vec<models::TaskLogRow>> {
        delegate!(self, query_task_logs, task_name, level, since_ms, limit)
    }
    fn purge_task_logs(&self, older_than_ms: i64) -> Result<u64> {
        delegate!(self, purge_task_logs, older_than_ms)
    }
    fn get_circuit_breaker(&self, task_name: &str) -> Result<Option<models::CircuitBreakerRow>> {
        delegate!(self, get_circuit_breaker, task_name)
    }
    fn upsert_circuit_breaker(&self, row: &models::CircuitBreakerRow) -> Result<()> {
        delegate!(self, upsert_circuit_breaker, row)
    }
    fn list_circuit_breakers(&self) -> Result<Vec<models::CircuitBreakerRow>> {
        delegate!(self, list_circuit_breakers)
    }
    fn register_worker(&self, worker_id: &str, queues: &str) -> Result<()> {
        delegate!(self, register_worker, worker_id, queues)
    }
    fn heartbeat(&self, worker_id: &str) -> Result<()> {
        delegate!(self, heartbeat, worker_id)
    }
    fn list_workers(&self) -> Result<Vec<models::WorkerRow>> {
        delegate!(self, list_workers)
    }
    fn reap_dead_workers(&self) -> Result<u64> {
        delegate!(self, reap_dead_workers)
    }
    fn unregister_worker(&self, worker_id: &str) -> Result<()> {
        delegate!(self, unregister_worker, worker_id)
    }
}
