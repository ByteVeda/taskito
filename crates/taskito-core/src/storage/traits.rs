use crate::error::Result;
use crate::job::{Job, NewJob};
use crate::storage::models::*;
use crate::storage::sqlite::{DeadJob, QueueStats};

/// Trait abstracting the storage backend for the task queue.
///
/// `SqliteStorage` is the primary implementation. This trait enables
/// alternative backends and simplifies testing with mock storage.
pub trait Storage: Send + Sync + Clone {
    // ── Job operations ──────────────────────────────────────────────

    fn enqueue(&self, new_job: NewJob) -> Result<Job>;
    fn enqueue_batch(&self, new_jobs: Vec<NewJob>) -> Result<Vec<Job>>;
    fn enqueue_unique(&self, new_job: NewJob) -> Result<Job>;
    fn dequeue(&self, queue_name: &str, now: i64) -> Result<Option<Job>>;
    fn dequeue_from(&self, queues: &[String], now: i64) -> Result<Option<Job>>;
    fn complete(&self, id: &str, result_bytes: Option<Vec<u8>>) -> Result<()>;
    fn fail(&self, id: &str, error: &str) -> Result<()>;
    fn retry(&self, id: &str, next_scheduled_at: i64) -> Result<()>;
    fn cancel_job(&self, id: &str) -> Result<bool>;
    fn request_cancel(&self, id: &str) -> Result<bool>;
    fn is_cancel_requested(&self, id: &str) -> Result<bool>;
    fn mark_cancelled(&self, id: &str) -> Result<()>;
    fn cascade_cancel(&self, failed_job_id: &str, reason: &str) -> Result<()>;
    fn get_dependencies(&self, job_id: &str) -> Result<Vec<String>>;
    fn get_dependents(&self, job_id: &str) -> Result<Vec<String>>;
    fn update_progress(&self, id: &str, progress: i32) -> Result<()>;
    fn list_jobs(
        &self,
        status: Option<i32>,
        queue_name: Option<&str>,
        task_name: Option<&str>,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<Job>>;
    fn get_job(&self, id: &str) -> Result<Option<Job>>;
    fn stats(&self) -> Result<QueueStats>;
    fn purge_completed(&self, older_than_ms: i64) -> Result<u64>;
    fn reap_stale_jobs(&self, now: i64) -> Result<Vec<Job>>;
    fn record_error(&self, job_id: &str, attempt: i32, error: &str) -> Result<()>;
    fn get_job_errors(&self, job_id: &str) -> Result<Vec<JobErrorRow>>;
    fn purge_job_errors(&self, older_than_ms: i64) -> Result<u64>;

    // ── Dead letter operations ──────────────────────────────────────

    fn move_to_dlq(&self, job: &Job, error: &str, metadata: Option<&str>) -> Result<()>;
    fn list_dead(&self, limit: i64, offset: i64) -> Result<Vec<DeadJob>>;
    fn retry_dead(&self, dead_id: &str) -> Result<String>;
    fn purge_dead(&self, older_than_ms: i64) -> Result<u64>;

    // ── Rate limit operations ───────────────────────────────────────

    fn get_rate_limit(&self, key: &str) -> Result<Option<RateLimitRow>>;
    fn upsert_rate_limit(&self, row: &RateLimitRow) -> Result<()>;

    // ── Periodic task operations ────────────────────────────────────

    fn register_periodic(&self, task: &NewPeriodicTaskRow) -> Result<()>;
    fn get_due_periodic(&self, now: i64) -> Result<Vec<PeriodicTaskRow>>;
    fn update_periodic_schedule(&self, name: &str, last_run: i64, next_run: i64) -> Result<()>;

    // ── Metrics operations ──────────────────────────────────────────

    fn record_metric(
        &self,
        task_name: &str,
        job_id: &str,
        wall_time_ns: i64,
        memory_bytes: i64,
        succeeded: bool,
    ) -> Result<()>;
    fn get_metrics(&self, name: Option<&str>, since_ms: i64) -> Result<Vec<TaskMetricRow>>;
    fn purge_metrics(&self, older_than_ms: i64) -> Result<u64>;
    fn record_replay(
        &self,
        original_job_id: &str,
        replay_job_id: &str,
        original_result: Option<&[u8]>,
        replay_result: Option<&[u8]>,
        original_error: Option<&str>,
        replay_error: Option<&str>,
    ) -> Result<()>;
    fn get_replay_history(&self, original_job_id: &str) -> Result<Vec<ReplayHistoryRow>>;

    // ── Log operations ──────────────────────────────────────────────

    fn write_task_log(
        &self,
        job_id: &str,
        task_name: &str,
        level: &str,
        message: &str,
        extra: Option<&str>,
    ) -> Result<()>;
    fn get_task_logs(&self, job_id: &str) -> Result<Vec<TaskLogRow>>;
    fn query_task_logs(
        &self,
        task_name: Option<&str>,
        level: Option<&str>,
        since_ms: i64,
        limit: i64,
    ) -> Result<Vec<TaskLogRow>>;
    fn purge_task_logs(&self, older_than_ms: i64) -> Result<u64>;

    // ── Circuit breaker operations ──────────────────────────────────

    fn get_circuit_breaker(&self, task_name: &str) -> Result<Option<CircuitBreakerRow>>;
    fn upsert_circuit_breaker(&self, row: &CircuitBreakerRow) -> Result<()>;
    fn list_circuit_breakers(&self) -> Result<Vec<CircuitBreakerRow>>;

    // ── Worker operations ───────────────────────────────────────────

    fn register_worker(&self, worker_id: &str, queues: &str) -> Result<()>;
    fn heartbeat(&self, worker_id: &str) -> Result<()>;
    fn list_workers(&self) -> Result<Vec<WorkerRow>>;
    fn reap_dead_workers(&self) -> Result<u64>;
    fn unregister_worker(&self, worker_id: &str) -> Result<()>;
}
