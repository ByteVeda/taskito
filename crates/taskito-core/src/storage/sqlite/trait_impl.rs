use crate::error::Result;
use crate::job::{Job, NewJob};
use crate::storage::models::*;
use crate::storage::traits::Storage;
use crate::storage::{DeadJob, QueueStats};
use super::SqliteStorage;

impl Storage for SqliteStorage {
    fn enqueue(&self, new_job: NewJob) -> Result<Job> { self.enqueue(new_job) }
    fn enqueue_batch(&self, new_jobs: Vec<NewJob>) -> Result<Vec<Job>> { self.enqueue_batch(new_jobs) }
    fn enqueue_unique(&self, new_job: NewJob) -> Result<Job> { self.enqueue_unique(new_job) }
    fn dequeue(&self, queue_name: &str, now: i64) -> Result<Option<Job>> { self.dequeue(queue_name, now) }
    fn dequeue_from(&self, queues: &[String], now: i64) -> Result<Option<Job>> { self.dequeue_from(queues, now) }
    fn complete(&self, id: &str, result_bytes: Option<Vec<u8>>) -> Result<()> { self.complete(id, result_bytes) }
    fn fail(&self, id: &str, error: &str) -> Result<()> { self.fail(id, error) }
    fn retry(&self, id: &str, next_scheduled_at: i64) -> Result<()> { self.retry(id, next_scheduled_at) }
    fn cancel_job(&self, id: &str) -> Result<bool> { self.cancel_job(id) }
    fn cascade_cancel(&self, failed_job_id: &str, reason: &str) -> Result<()> { self.cascade_cancel(failed_job_id, reason) }
    fn get_dependencies(&self, job_id: &str) -> Result<Vec<String>> { self.get_dependencies(job_id) }
    fn get_dependents(&self, job_id: &str) -> Result<Vec<String>> { self.get_dependents(job_id) }
    fn update_progress(&self, id: &str, progress: i32) -> Result<()> { self.update_progress(id, progress) }
    fn list_jobs(&self, status: Option<i32>, queue_name: Option<&str>, task_name: Option<&str>, limit: i64, offset: i64) -> Result<Vec<Job>> {
        self.list_jobs(status, queue_name, task_name, limit, offset)
    }
    fn get_job(&self, id: &str) -> Result<Option<Job>> { self.get_job(id) }
    fn stats(&self) -> Result<QueueStats> { self.stats() }
    fn purge_completed(&self, older_than_ms: i64) -> Result<u64> { self.purge_completed(older_than_ms) }
    fn purge_completed_with_ttl(&self, global_cutoff_ms: i64) -> Result<u64> { self.purge_completed_with_ttl(global_cutoff_ms) }
    fn reap_stale_jobs(&self, now: i64) -> Result<Vec<Job>> { self.reap_stale_jobs(now) }
    fn record_error(&self, job_id: &str, attempt: i32, error: &str) -> Result<()> { self.record_error(job_id, attempt, error) }
    fn get_job_errors(&self, job_id: &str) -> Result<Vec<JobErrorRow>> { self.get_job_errors(job_id) }
    fn purge_job_errors(&self, older_than_ms: i64) -> Result<u64> { self.purge_job_errors(older_than_ms) }
    fn move_to_dlq(&self, job: &Job, error: &str, metadata: Option<&str>) -> Result<()> { self.move_to_dlq(job, error, metadata) }
    fn list_dead(&self, limit: i64, offset: i64) -> Result<Vec<DeadJob>> { self.list_dead(limit, offset) }
    fn retry_dead(&self, dead_id: &str) -> Result<String> { self.retry_dead(dead_id) }
    fn purge_dead(&self, older_than_ms: i64) -> Result<u64> { self.purge_dead(older_than_ms) }
    fn get_rate_limit(&self, key: &str) -> Result<Option<RateLimitRow>> { self.get_rate_limit(key) }
    fn upsert_rate_limit(&self, row: &RateLimitRow) -> Result<()> { self.upsert_rate_limit(row) }
    fn try_acquire_token(&self, key: &str, max_tokens: f64, refill_rate: f64) -> Result<bool> { self.try_acquire_token(key, max_tokens, refill_rate) }
    fn register_periodic(&self, task: &NewPeriodicTaskRow) -> Result<()> { self.register_periodic(task) }
    fn get_due_periodic(&self, now: i64) -> Result<Vec<PeriodicTaskRow>> { self.get_due_periodic(now) }
    fn update_periodic_schedule(&self, name: &str, last_run: i64, next_run: i64) -> Result<()> { self.update_periodic_schedule(name, last_run, next_run) }
    fn record_metric(&self, task_name: &str, job_id: &str, wall_time_ns: i64, memory_bytes: i64, succeeded: bool) -> Result<()> {
        self.record_metric(task_name, job_id, wall_time_ns, memory_bytes, succeeded)
    }
    fn get_metrics(&self, name: Option<&str>, since_ms: i64) -> Result<Vec<TaskMetricRow>> { self.get_metrics(name, since_ms) }
    fn purge_metrics(&self, older_than_ms: i64) -> Result<u64> { self.purge_metrics(older_than_ms) }
    fn record_replay(&self, original_job_id: &str, replay_job_id: &str, original_result: Option<&[u8]>, replay_result: Option<&[u8]>, original_error: Option<&str>, replay_error: Option<&str>) -> Result<()> {
        self.record_replay(original_job_id, replay_job_id, original_result, replay_result, original_error, replay_error)
    }
    fn get_replay_history(&self, original_job_id: &str) -> Result<Vec<ReplayHistoryRow>> { self.get_replay_history(original_job_id) }
    fn write_task_log(&self, job_id: &str, task_name: &str, level: &str, message: &str, extra: Option<&str>) -> Result<()> {
        self.write_task_log(job_id, task_name, level, message, extra)
    }
    fn get_task_logs(&self, job_id: &str) -> Result<Vec<TaskLogRow>> { self.get_task_logs(job_id) }
    fn query_task_logs(&self, task_name: Option<&str>, level: Option<&str>, since_ms: i64, limit: i64) -> Result<Vec<TaskLogRow>> {
        self.query_task_logs(task_name, level, since_ms, limit)
    }
    fn purge_task_logs(&self, older_than_ms: i64) -> Result<u64> { self.purge_task_logs(older_than_ms) }
    fn get_circuit_breaker(&self, task_name: &str) -> Result<Option<CircuitBreakerRow>> { self.get_circuit_breaker(task_name) }
    fn upsert_circuit_breaker(&self, row: &CircuitBreakerRow) -> Result<()> { self.upsert_circuit_breaker(row) }
    fn list_circuit_breakers(&self) -> Result<Vec<CircuitBreakerRow>> { self.list_circuit_breakers() }
    fn request_cancel(&self, id: &str) -> Result<bool> { self.request_cancel(id) }
    fn is_cancel_requested(&self, id: &str) -> Result<bool> { self.is_cancel_requested(id) }
    fn mark_cancelled(&self, id: &str) -> Result<()> { self.mark_cancelled(id) }
    fn register_worker(&self, worker_id: &str, queues: &str) -> Result<()> { self.register_worker(worker_id, queues) }
    fn heartbeat(&self, worker_id: &str) -> Result<()> { self.heartbeat(worker_id) }
    fn list_workers(&self) -> Result<Vec<WorkerRow>> { self.list_workers() }
    fn reap_dead_workers(&self) -> Result<u64> { self.reap_dead_workers() }
    fn unregister_worker(&self, worker_id: &str) -> Result<()> { self.unregister_worker(worker_id) }
}
