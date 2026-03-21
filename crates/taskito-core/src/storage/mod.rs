mod diesel_common;
pub mod models;
#[cfg(feature = "postgres")]
pub mod postgres;
#[cfg(feature = "redis")]
pub mod redis_backend;
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
    pub namespace: Option<String>,
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
            namespace: row.namespace,
        }
    }
}

// ── impl_storage! macro ───────────────────────────────────────────────
//
// Every concrete backend (Sqlite, Postgres, Redis) has inherent methods
// with the same signatures as the `Storage` trait.  This macro generates
// the trivial `impl Storage for $T` block that forwards every call.

macro_rules! impl_storage {
    ($type:ty) => {
        impl $crate::storage::traits::Storage for $type {
            fn enqueue(
                &self,
                new_job: $crate::job::NewJob,
            ) -> $crate::error::Result<$crate::job::Job> {
                self.enqueue(new_job)
            }
            fn enqueue_batch(
                &self,
                new_jobs: Vec<$crate::job::NewJob>,
            ) -> $crate::error::Result<Vec<$crate::job::Job>> {
                self.enqueue_batch(new_jobs)
            }
            fn enqueue_unique(
                &self,
                new_job: $crate::job::NewJob,
            ) -> $crate::error::Result<$crate::job::Job> {
                self.enqueue_unique(new_job)
            }
            fn dequeue(
                &self,
                queue_name: &str,
                now: i64,
                namespace: Option<&str>,
            ) -> $crate::error::Result<Option<$crate::job::Job>> {
                self.dequeue(queue_name, now, namespace)
            }
            fn dequeue_from(
                &self,
                queues: &[String],
                now: i64,
                namespace: Option<&str>,
            ) -> $crate::error::Result<Option<$crate::job::Job>> {
                self.dequeue_from(queues, now, namespace)
            }
            fn complete(
                &self,
                id: &str,
                result_bytes: Option<Vec<u8>>,
            ) -> $crate::error::Result<()> {
                self.complete(id, result_bytes)
            }
            fn fail(&self, id: &str, error: &str) -> $crate::error::Result<()> {
                self.fail(id, error)
            }
            fn retry(&self, id: &str, next_scheduled_at: i64) -> $crate::error::Result<()> {
                self.retry(id, next_scheduled_at)
            }
            fn cancel_job(&self, id: &str) -> $crate::error::Result<bool> {
                self.cancel_job(id)
            }
            fn request_cancel(&self, id: &str) -> $crate::error::Result<bool> {
                self.request_cancel(id)
            }
            fn is_cancel_requested(&self, id: &str) -> $crate::error::Result<bool> {
                self.is_cancel_requested(id)
            }
            fn mark_cancelled(&self, id: &str) -> $crate::error::Result<()> {
                self.mark_cancelled(id)
            }
            fn cascade_cancel(
                &self,
                failed_job_id: &str,
                reason: &str,
            ) -> $crate::error::Result<()> {
                self.cascade_cancel(failed_job_id, reason)
            }
            fn get_dependencies(&self, job_id: &str) -> $crate::error::Result<Vec<String>> {
                self.get_dependencies(job_id)
            }
            fn get_dependents(&self, job_id: &str) -> $crate::error::Result<Vec<String>> {
                self.get_dependents(job_id)
            }
            fn update_progress(&self, id: &str, progress: i32) -> $crate::error::Result<()> {
                self.update_progress(id, progress)
            }
            fn list_jobs(
                &self,
                status: Option<i32>,
                queue_name: Option<&str>,
                task_name: Option<&str>,
                limit: i64,
                offset: i64,
                namespace: Option<&str>,
            ) -> $crate::error::Result<Vec<$crate::job::Job>> {
                self.list_jobs(status, queue_name, task_name, limit, offset, namespace)
            }
            fn get_job(&self, id: &str) -> $crate::error::Result<Option<$crate::job::Job>> {
                self.get_job(id)
            }
            fn stats(&self) -> $crate::error::Result<$crate::storage::QueueStats> {
                self.stats()
            }
            fn purge_completed(&self, older_than_ms: i64) -> $crate::error::Result<u64> {
                self.purge_completed(older_than_ms)
            }
            fn purge_completed_with_ttl(
                &self,
                global_cutoff_ms: i64,
            ) -> $crate::error::Result<u64> {
                self.purge_completed_with_ttl(global_cutoff_ms)
            }
            fn reap_stale_jobs(&self, now: i64) -> $crate::error::Result<Vec<$crate::job::Job>> {
                self.reap_stale_jobs(now)
            }
            fn record_error(
                &self,
                job_id: &str,
                attempt: i32,
                error: &str,
            ) -> $crate::error::Result<()> {
                self.record_error(job_id, attempt, error)
            }
            fn get_job_errors(
                &self,
                job_id: &str,
            ) -> $crate::error::Result<Vec<$crate::storage::models::JobErrorRow>> {
                self.get_job_errors(job_id)
            }
            fn purge_job_errors(&self, older_than_ms: i64) -> $crate::error::Result<u64> {
                self.purge_job_errors(older_than_ms)
            }
            fn move_to_dlq(
                &self,
                job: &$crate::job::Job,
                error: &str,
                metadata: Option<&str>,
            ) -> $crate::error::Result<()> {
                self.move_to_dlq(job, error, metadata)
            }
            fn list_dead(
                &self,
                limit: i64,
                offset: i64,
            ) -> $crate::error::Result<Vec<$crate::storage::DeadJob>> {
                self.list_dead(limit, offset)
            }
            fn retry_dead(&self, dead_id: &str) -> $crate::error::Result<String> {
                self.retry_dead(dead_id)
            }
            fn purge_dead(&self, older_than_ms: i64) -> $crate::error::Result<u64> {
                self.purge_dead(older_than_ms)
            }
            fn get_rate_limit(
                &self,
                key: &str,
            ) -> $crate::error::Result<Option<$crate::storage::models::RateLimitRow>> {
                self.get_rate_limit(key)
            }
            fn upsert_rate_limit(
                &self,
                row: &$crate::storage::models::RateLimitRow,
            ) -> $crate::error::Result<()> {
                self.upsert_rate_limit(row)
            }
            fn try_acquire_token(
                &self,
                key: &str,
                max_tokens: f64,
                refill_rate: f64,
            ) -> $crate::error::Result<bool> {
                self.try_acquire_token(key, max_tokens, refill_rate)
            }
            fn register_periodic(
                &self,
                task: &$crate::storage::models::NewPeriodicTaskRow,
            ) -> $crate::error::Result<()> {
                self.register_periodic(task)
            }
            fn get_due_periodic(
                &self,
                now: i64,
            ) -> $crate::error::Result<Vec<$crate::storage::models::PeriodicTaskRow>> {
                self.get_due_periodic(now)
            }
            fn update_periodic_schedule(
                &self,
                name: &str,
                last_run: i64,
                next_run: i64,
            ) -> $crate::error::Result<()> {
                self.update_periodic_schedule(name, last_run, next_run)
            }
            fn record_metric(
                &self,
                task_name: &str,
                job_id: &str,
                wall_time_ns: i64,
                memory_bytes: i64,
                succeeded: bool,
            ) -> $crate::error::Result<()> {
                self.record_metric(task_name, job_id, wall_time_ns, memory_bytes, succeeded)
            }
            fn get_metrics(
                &self,
                name: Option<&str>,
                since_ms: i64,
            ) -> $crate::error::Result<Vec<$crate::storage::models::TaskMetricRow>> {
                self.get_metrics(name, since_ms)
            }
            fn purge_metrics(&self, older_than_ms: i64) -> $crate::error::Result<u64> {
                self.purge_metrics(older_than_ms)
            }
            fn record_replay(
                &self,
                original_job_id: &str,
                replay_job_id: &str,
                original_result: Option<&[u8]>,
                replay_result: Option<&[u8]>,
                original_error: Option<&str>,
                replay_error: Option<&str>,
            ) -> $crate::error::Result<()> {
                self.record_replay(
                    original_job_id,
                    replay_job_id,
                    original_result,
                    replay_result,
                    original_error,
                    replay_error,
                )
            }
            fn get_replay_history(
                &self,
                original_job_id: &str,
            ) -> $crate::error::Result<Vec<$crate::storage::models::ReplayHistoryRow>> {
                self.get_replay_history(original_job_id)
            }
            fn write_task_log(
                &self,
                job_id: &str,
                task_name: &str,
                level: &str,
                message: &str,
                extra: Option<&str>,
            ) -> $crate::error::Result<()> {
                self.write_task_log(job_id, task_name, level, message, extra)
            }
            fn get_task_logs(
                &self,
                job_id: &str,
            ) -> $crate::error::Result<Vec<$crate::storage::models::TaskLogRow>> {
                self.get_task_logs(job_id)
            }
            fn query_task_logs(
                &self,
                task_name: Option<&str>,
                level: Option<&str>,
                since_ms: i64,
                limit: i64,
            ) -> $crate::error::Result<Vec<$crate::storage::models::TaskLogRow>> {
                self.query_task_logs(task_name, level, since_ms, limit)
            }
            fn purge_task_logs(&self, older_than_ms: i64) -> $crate::error::Result<u64> {
                self.purge_task_logs(older_than_ms)
            }
            fn get_circuit_breaker(
                &self,
                task_name: &str,
            ) -> $crate::error::Result<Option<$crate::storage::models::CircuitBreakerRow>> {
                self.get_circuit_breaker(task_name)
            }
            fn upsert_circuit_breaker(
                &self,
                row: &$crate::storage::models::CircuitBreakerRow,
            ) -> $crate::error::Result<()> {
                self.upsert_circuit_breaker(row)
            }
            fn list_circuit_breakers(
                &self,
            ) -> $crate::error::Result<Vec<$crate::storage::models::CircuitBreakerRow>> {
                self.list_circuit_breakers()
            }
            fn register_worker(
                &self,
                worker_id: &str,
                queues: &str,
                tags: Option<&str>,
                resources: Option<&str>,
                resource_health: Option<&str>,
                threads: i32,
                hostname: Option<&str>,
                pid: Option<i32>,
                pool_type: Option<&str>,
            ) -> $crate::error::Result<()> {
                self.register_worker(worker_id, queues, tags, resources, resource_health, threads, hostname, pid, pool_type)
            }
            fn heartbeat(
                &self,
                worker_id: &str,
                resource_health: Option<&str>,
            ) -> $crate::error::Result<()> {
                self.heartbeat(worker_id, resource_health)
            }
            fn update_worker_status(
                &self,
                worker_id: &str,
                status: &str,
            ) -> $crate::error::Result<()> {
                self.update_worker_status(worker_id, status)
            }
            fn list_workers(
                &self,
            ) -> $crate::error::Result<Vec<$crate::storage::models::WorkerRow>> {
                self.list_workers()
            }
            fn reap_dead_workers(&self) -> $crate::error::Result<Vec<String>> {
                self.reap_dead_workers()
            }
            fn unregister_worker(&self, worker_id: &str) -> $crate::error::Result<()> {
                self.unregister_worker(worker_id)
            }
            fn list_claims_by_worker(&self, worker_id: &str) -> $crate::error::Result<Vec<String>> {
                self.list_claims_by_worker(worker_id)
            }
            fn pause_queue(&self, queue_name: &str) -> $crate::error::Result<()> {
                self.pause_queue(queue_name)
            }
            fn resume_queue(&self, queue_name: &str) -> $crate::error::Result<()> {
                self.resume_queue(queue_name)
            }
            fn list_paused_queues(&self) -> $crate::error::Result<Vec<String>> {
                self.list_paused_queues()
            }
            fn expire_pending_jobs(&self, now: i64) -> $crate::error::Result<u64> {
                self.expire_pending_jobs(now)
            }
            fn cancel_pending_by_queue(&self, queue: &str) -> $crate::error::Result<u64> {
                self.cancel_pending_by_queue(queue)
            }
            fn cancel_pending_by_task(&self, task_name: &str) -> $crate::error::Result<u64> {
                self.cancel_pending_by_task(task_name)
            }
            fn archive_old_jobs(&self, cutoff_ms: i64) -> $crate::error::Result<u64> {
                self.archive_old_jobs(cutoff_ms)
            }
            fn list_archived(
                &self,
                limit: i64,
                offset: i64,
            ) -> $crate::error::Result<Vec<$crate::job::Job>> {
                self.list_archived(limit, offset)
            }
            fn acquire_lock(
                &self,
                lock_name: &str,
                owner_id: &str,
                ttl_ms: i64,
            ) -> $crate::error::Result<bool> {
                self.acquire_lock(lock_name, owner_id, ttl_ms)
            }
            fn release_lock(
                &self,
                lock_name: &str,
                owner_id: &str,
            ) -> $crate::error::Result<bool> {
                self.release_lock(lock_name, owner_id)
            }
            fn extend_lock(
                &self,
                lock_name: &str,
                owner_id: &str,
                ttl_ms: i64,
            ) -> $crate::error::Result<bool> {
                self.extend_lock(lock_name, owner_id, ttl_ms)
            }
            fn get_lock_info(
                &self,
                lock_name: &str,
            ) -> $crate::error::Result<Option<$crate::storage::models::LockInfoRow>> {
                self.get_lock_info(lock_name)
            }
            fn reap_expired_locks(&self, now: i64) -> $crate::error::Result<u64> {
                self.reap_expired_locks(now)
            }
            fn claim_execution(
                &self,
                job_id: &str,
                worker_id: &str,
            ) -> $crate::error::Result<bool> {
                self.claim_execution(job_id, worker_id)
            }
            fn complete_execution(&self, job_id: &str) -> $crate::error::Result<()> {
                self.complete_execution(job_id)
            }
            fn purge_execution_claims(
                &self,
                older_than_ms: i64,
            ) -> $crate::error::Result<u64> {
                self.purge_execution_claims(older_than_ms)
            }
            fn count_running_by_task(
                &self,
                task_name: &str,
            ) -> $crate::error::Result<i64> {
                self.count_running_by_task(task_name)
            }
            fn stats_by_queue(
                &self,
                queue_name: &str,
            ) -> $crate::error::Result<$crate::storage::QueueStats> {
                self.stats_by_queue(queue_name)
            }
            fn stats_all_queues(
                &self,
            ) -> $crate::error::Result<std::collections::HashMap<String, $crate::storage::QueueStats>>
            {
                self.stats_all_queues()
            }
            fn list_jobs_filtered(
                &self,
                status: Option<i32>,
                queue_name: Option<&str>,
                task_name: Option<&str>,
                metadata_like: Option<&str>,
                error_like: Option<&str>,
                created_after: Option<i64>,
                created_before: Option<i64>,
                limit: i64,
                offset: i64,
                namespace: Option<&str>,
            ) -> $crate::error::Result<Vec<$crate::job::Job>> {
                self.list_jobs_filtered(
                    status,
                    queue_name,
                    task_name,
                    metadata_like,
                    error_like,
                    created_after,
                    created_before,
                    limit,
                    offset,
                    namespace,
                )
            }
        }
    };
}

pub(crate) use impl_storage;

// ── Backend-agnostic storage wrapper ──────────────────────────────────

/// Storage backend enum that dispatches to either SQLite or PostgreSQL.
#[derive(Clone)]
pub enum StorageBackend {
    Sqlite(sqlite::SqliteStorage),
    #[cfg(feature = "postgres")]
    Postgres(postgres::PostgresStorage),
    #[cfg(feature = "redis")]
    Redis(redis_backend::RedisStorage),
}

macro_rules! delegate {
    ($self:expr, $method:ident $(, $arg:expr)*) => {
        match $self {
            StorageBackend::Sqlite(s) => s.$method($($arg),*),
            #[cfg(feature = "postgres")]
            StorageBackend::Postgres(s) => s.$method($($arg),*),
            #[cfg(feature = "redis")]
            StorageBackend::Redis(s) => s.$method($($arg),*),
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
    fn dequeue(&self, queue_name: &str, now: i64, namespace: Option<&str>) -> Result<Option<Job>> {
        delegate!(self, dequeue, queue_name, now, namespace)
    }
    fn dequeue_from(
        &self,
        queues: &[String],
        now: i64,
        namespace: Option<&str>,
    ) -> Result<Option<Job>> {
        delegate!(self, dequeue_from, queues, now, namespace)
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
        namespace: Option<&str>,
    ) -> Result<Vec<Job>> {
        delegate!(self, list_jobs, status, queue_name, task_name, limit, offset, namespace)
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
    fn register_worker(
        &self,
        worker_id: &str,
        queues: &str,
        tags: Option<&str>,
        resources: Option<&str>,
        resource_health: Option<&str>,
        threads: i32,
        hostname: Option<&str>,
        pid: Option<i32>,
        pool_type: Option<&str>,
    ) -> Result<()> {
        delegate!(
            self,
            register_worker,
            worker_id,
            queues,
            tags,
            resources,
            resource_health,
            threads,
            hostname,
            pid,
            pool_type
        )
    }
    fn heartbeat(&self, worker_id: &str, resource_health: Option<&str>) -> Result<()> {
        delegate!(self, heartbeat, worker_id, resource_health)
    }
    fn update_worker_status(&self, worker_id: &str, status: &str) -> Result<()> {
        delegate!(self, update_worker_status, worker_id, status)
    }
    fn list_workers(&self) -> Result<Vec<models::WorkerRow>> {
        delegate!(self, list_workers)
    }
    fn reap_dead_workers(&self) -> Result<Vec<String>> {
        delegate!(self, reap_dead_workers)
    }
    fn unregister_worker(&self, worker_id: &str) -> Result<()> {
        delegate!(self, unregister_worker, worker_id)
    }
    fn list_claims_by_worker(&self, worker_id: &str) -> Result<Vec<String>> {
        delegate!(self, list_claims_by_worker, worker_id)
    }
    fn pause_queue(&self, queue_name: &str) -> Result<()> {
        delegate!(self, pause_queue, queue_name)
    }
    fn resume_queue(&self, queue_name: &str) -> Result<()> {
        delegate!(self, resume_queue, queue_name)
    }
    fn list_paused_queues(&self) -> Result<Vec<String>> {
        delegate!(self, list_paused_queues)
    }
    fn expire_pending_jobs(&self, now: i64) -> Result<u64> {
        delegate!(self, expire_pending_jobs, now)
    }
    fn cancel_pending_by_queue(&self, queue: &str) -> Result<u64> {
        delegate!(self, cancel_pending_by_queue, queue)
    }
    fn cancel_pending_by_task(&self, task_name: &str) -> Result<u64> {
        delegate!(self, cancel_pending_by_task, task_name)
    }
    fn archive_old_jobs(&self, cutoff_ms: i64) -> Result<u64> {
        delegate!(self, archive_old_jobs, cutoff_ms)
    }
    fn list_archived(&self, limit: i64, offset: i64) -> Result<Vec<Job>> {
        delegate!(self, list_archived, limit, offset)
    }
    fn acquire_lock(&self, lock_name: &str, owner_id: &str, ttl_ms: i64) -> Result<bool> {
        delegate!(self, acquire_lock, lock_name, owner_id, ttl_ms)
    }
    fn release_lock(&self, lock_name: &str, owner_id: &str) -> Result<bool> {
        delegate!(self, release_lock, lock_name, owner_id)
    }
    fn extend_lock(&self, lock_name: &str, owner_id: &str, ttl_ms: i64) -> Result<bool> {
        delegate!(self, extend_lock, lock_name, owner_id, ttl_ms)
    }
    fn get_lock_info(&self, lock_name: &str) -> Result<Option<models::LockInfoRow>> {
        delegate!(self, get_lock_info, lock_name)
    }
    fn reap_expired_locks(&self, now: i64) -> Result<u64> {
        delegate!(self, reap_expired_locks, now)
    }
    fn claim_execution(&self, job_id: &str, worker_id: &str) -> Result<bool> {
        delegate!(self, claim_execution, job_id, worker_id)
    }
    fn complete_execution(&self, job_id: &str) -> Result<()> {
        delegate!(self, complete_execution, job_id)
    }
    fn purge_execution_claims(&self, older_than_ms: i64) -> Result<u64> {
        delegate!(self, purge_execution_claims, older_than_ms)
    }
    fn count_running_by_task(&self, task_name: &str) -> Result<i64> {
        delegate!(self, count_running_by_task, task_name)
    }
    fn stats_by_queue(&self, queue_name: &str) -> Result<QueueStats> {
        delegate!(self, stats_by_queue, queue_name)
    }
    fn stats_all_queues(&self) -> Result<std::collections::HashMap<String, QueueStats>> {
        delegate!(self, stats_all_queues)
    }
    fn list_jobs_filtered(
        &self,
        status: Option<i32>,
        queue_name: Option<&str>,
        task_name: Option<&str>,
        metadata_like: Option<&str>,
        error_like: Option<&str>,
        created_after: Option<i64>,
        created_before: Option<i64>,
        limit: i64,
        offset: i64,
        namespace: Option<&str>,
    ) -> Result<Vec<Job>> {
        delegate!(
            self,
            list_jobs_filtered,
            status,
            queue_name,
            task_name,
            metadata_like,
            error_like,
            created_after,
            created_before,
            limit,
            offset,
            namespace
        )
    }
}
