use crate::error::Result;
use crate::job::{Job, NewJob};
use crate::storage::models::*;
use crate::storage::{DeadJob, QueueStats, SubscriptionBacklogStats};

/// Trait abstracting the storage backend for the task queue.
///
/// Implementations: `SqliteStorage` (default), `PostgresStorage` (feature
/// `postgres`), and `RedisStorage` (feature `redis`). The trait enables
/// alternative backends and simplifies testing with mock storage.
pub trait Storage: Send + Sync + Clone {
    // ── Job operations ──────────────────────────────────────────────

    fn enqueue(&self, new_job: NewJob) -> Result<Job>;
    fn enqueue_batch(&self, new_jobs: Vec<NewJob>) -> Result<Vec<Job>>;
    fn enqueue_unique(&self, new_job: NewJob) -> Result<Job>;
    fn enqueue_unique_batch(&self, new_jobs: Vec<NewJob>) -> Result<Vec<Job>>;
    fn dequeue(&self, queue_name: &str, now: i64, namespace: Option<&str>) -> Result<Option<Job>>;
    fn dequeue_from(
        &self,
        queues: &[String],
        now: i64,
        namespace: Option<&str>,
    ) -> Result<Option<Job>>;
    /// Atomically claim up to `max` ready jobs from a single queue in one
    /// transaction. Returns the claimed jobs (now in `Running` state). May
    /// return fewer than `max` if the queue lacks enough eligible jobs.
    fn dequeue_batch(
        &self,
        queue_name: &str,
        now: i64,
        namespace: Option<&str>,
        max: usize,
    ) -> Result<Vec<Job>>;
    /// Claim up to `max` ready jobs across the given queues, checking each in
    /// order until the budget is exhausted.
    fn dequeue_batch_from(
        &self,
        queues: &[String],
        now: i64,
        namespace: Option<&str>,
        max: usize,
    ) -> Result<Vec<Job>>;
    fn complete(&self, id: &str, result_bytes: Option<Vec<u8>>) -> Result<()>;

    /// Persist many successful completions at once. Each entry archives the
    /// completed job, clears its execution claim, and records its metric — the
    /// Diesel backends do so in one transaction. See [`JobCompletion`].
    ///
    /// [`JobCompletion`]: crate::job::JobCompletion
    fn complete_batch(&self, completions: &[crate::job::JobCompletion]) -> Result<()>;
    fn fail(&self, id: &str, error: &str) -> Result<()>;
    fn retry(&self, id: &str, next_scheduled_at: i64) -> Result<()>;
    /// Re-schedule a job back to `Pending` **without** consuming its retry
    /// budget. Used for soft-gate reschedules (rate limit, circuit breaker,
    /// concurrency cap, channel backpressure) where the job never executed,
    /// unlike [`retry`](Self::retry) which increments `retry_count`.
    fn reschedule(&self, id: &str, next_scheduled_at: i64) -> Result<()>;
    /// Force a `Running` job back to `Pending` and release its execution
    /// claim atomically, so a healthy worker can re-claim it. Preserves the
    /// retry budget (operator action, mirrors [`reschedule`](Self::reschedule))
    /// and clears any pending cancel request. Returns `false` when the job is
    /// missing or not `Running`. Only for confirmed-dead/hung workers: a
    /// still-alive owner may finish the old attempt, double-executing the job.
    fn requeue_stuck(&self, id: &str, now: i64) -> Result<bool>;
    fn cancel_job(&self, id: &str) -> Result<bool>;
    fn request_cancel(&self, id: &str) -> Result<bool>;
    fn is_cancel_requested(&self, id: &str) -> Result<bool>;
    fn mark_cancelled(&self, id: &str) -> Result<()>;
    fn cascade_cancel(&self, failed_job_id: &str, reason: &str) -> Result<()>;
    fn get_dependencies(&self, job_id: &str) -> Result<Vec<String>>;
    fn get_dependents(&self, job_id: &str) -> Result<Vec<String>>;
    fn update_progress(&self, id: &str, progress: i32) -> Result<()>;
    /// List jobs by filter. Rows are **blob-free** on every backend: the
    /// `payload`/`result` blobs come back empty (Diesel selects a narrow
    /// projection; Redis strips them post-load). Fetch the full job — blobs
    /// included — with [`Storage::get_job`]. The same contract holds for every
    /// listing method (`list_jobs_filtered`, `list_archived`, `list_dead*`).
    fn list_jobs(
        &self,
        status: Option<i32>,
        queue_name: Option<&str>,
        task_name: Option<&str>,
        limit: i64,
        offset: i64,
        namespace: Option<&str>,
    ) -> Result<Vec<Job>>;
    /// Keyset-paginated `list_jobs`, ordered by `(created_at, id)` descending.
    /// `after` is the `(created_at, id)` of the previous page's last row; the
    /// caller derives the next cursor from the returned rows' last element.
    /// O(page) at any depth, and stable under concurrent inserts (unlike the
    /// offset form). Rows are blob-free like every listing.
    fn list_jobs_after(
        &self,
        status: Option<i32>,
        queue_name: Option<&str>,
        task_name: Option<&str>,
        limit: i64,
        after: Option<(i64, &str)>,
        namespace: Option<&str>,
    ) -> Result<Vec<Job>>;
    fn get_job(&self, id: &str) -> Result<Option<Job>>;
    fn stats(&self) -> Result<QueueStats>;
    fn purge_completed(&self, older_than_ms: i64) -> Result<u64>;
    fn purge_completed_with_ttl(&self, global_cutoff_ms: i64) -> Result<u64>;
    fn reap_stale_jobs(&self, now: i64) -> Result<Vec<Job>>;
    /// Running jobs whose execution-claim owner is not in `live_owner_ids` (the
    /// worker that claimed them has died). Read-only — paired with the dead
    /// owner so the caller can atomically reclaim before requeuing.
    fn reap_orphaned_jobs(&self, live_owner_ids: &[String], now: i64)
        -> Result<Vec<(Job, String)>>;
    fn record_error(&self, job_id: &str, attempt: i32, error: &str) -> Result<()>;
    fn get_job_errors(&self, job_id: &str) -> Result<Vec<JobErrorRow>>;
    fn purge_job_errors(&self, older_than_ms: i64) -> Result<u64>;

    // ── Dead letter operations ──────────────────────────────────────

    fn move_to_dlq(&self, job: &Job, error: &str, metadata: Option<&str>) -> Result<()>;
    fn list_dead(&self, limit: i64, offset: i64) -> Result<Vec<DeadJob>>;
    /// Keyset-paginated `list_dead`, ordered by `(failed_at, id)` descending.
    /// See [`Storage::list_jobs_after`] for the cursor contract.
    fn list_dead_after(&self, limit: i64, after: Option<(i64, &str)>) -> Result<Vec<DeadJob>>;
    /// Dead-letter entries for one task, newest first, paginated.
    fn list_dead_by_task(&self, task_name: &str, limit: i64, offset: i64) -> Result<Vec<DeadJob>>;
    /// Delete every dead-letter entry for a task. Returns the number removed.
    fn purge_dead_by_task(&self, task_name: &str) -> Result<u64>;
    fn retry_dead(&self, dead_id: &str) -> Result<String>;
    fn purge_dead(&self, older_than_ms: i64) -> Result<u64>;
    fn delete_dead(&self, dead_id: &str) -> Result<bool>;
    fn purge_dead_with_ttl(&self, global_cutoff_ms: i64) -> Result<u64>;
    fn list_dead_for_retry(
        &self,
        cutoff_ms: i64,
        max_retries: i32,
        namespace: Option<&str>,
        queues: &[String],
        limit: i64,
    ) -> Result<Vec<DeadJob>>;

    // ── Rate limit operations ───────────────────────────────────────

    fn get_rate_limit(&self, key: &str) -> Result<Option<RateLimitRow>>;
    fn upsert_rate_limit(&self, row: &RateLimitRow) -> Result<()>;
    fn try_acquire_token(&self, key: &str, max_tokens: f64, refill_rate: f64) -> Result<bool>;

    // ── Periodic task operations ────────────────────────────────────

    fn register_periodic(&self, task: &NewPeriodicTaskRow) -> Result<()>;
    fn get_due_periodic(&self, now: i64) -> Result<Vec<PeriodicTaskRow>>;
    fn update_periodic_schedule(&self, name: &str, last_run: i64, next_run: i64) -> Result<()>;
    /// All registered periodic tasks, enabled or paused.
    fn list_periodic(&self) -> Result<Vec<PeriodicTaskRow>>;
    /// Remove a periodic task. Returns false if no task had that name.
    fn delete_periodic(&self, name: &str) -> Result<bool>;
    /// Pause (false) or resume (true) a periodic task by toggling `enabled`.
    /// Returns false if no task had that name.
    fn set_periodic_enabled(&self, name: &str, enabled: bool) -> Result<bool>;

    // ── Topic pub/sub ───────────────────────────────────────────────

    /// Insert or update a subscription. Idempotent on (topic, subscription_name).
    fn register_subscription(&self, sub: &NewSubscriptionRow) -> Result<()>;
    /// Active subscriptions for a topic (active = true only).
    fn list_subscriptions_for_topic(&self, topic: &str) -> Result<Vec<SubscriptionRow>>;
    /// Every registered subscription (active or paused), all topics.
    fn list_subscriptions(&self) -> Result<Vec<SubscriptionRow>>;
    /// Remove a subscription. Returns false if none matched.
    fn unsubscribe(&self, topic: &str, subscription_name: &str) -> Result<bool>;
    /// Pause/resume without removing registration. Returns false if none matched.
    fn set_subscription_active(
        &self,
        topic: &str,
        subscription_name: &str,
        active: bool,
    ) -> Result<bool>;
    /// Remove ephemeral subscriptions (owner_worker_id set) whose owner is not in
    /// `live_worker_ids`. Durable rows (owner NULL) are never touched. Returns the
    /// count removed.
    fn reap_ephemeral_subscriptions(&self, live_worker_ids: &[String]) -> Result<u64>;

    /// Backlog/lag snapshot for every registered subscription across all topics.
    /// Bounded by the pub/sub-tagged rows (partial index), never a full `jobs`
    /// table scan — safe to poll on a dashboard cadence.
    fn topic_backlog_stats(&self) -> Result<Vec<SubscriptionBacklogStats>>;

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
    /// Logs for a job with id strictly after `after_id` (UUIDv7 ids are
    /// time-ordered, so the id doubles as a stream cursor). `None` = all.
    fn get_task_logs_after(&self, job_id: &str, after_id: Option<&str>) -> Result<Vec<TaskLogRow>>;
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

    #[allow(clippy::too_many_arguments)]
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
    ) -> Result<()>;
    fn heartbeat(&self, worker_id: &str, resource_health: Option<&str>) -> Result<()>;
    fn update_worker_status(&self, worker_id: &str, status: &str) -> Result<()>;
    fn list_workers(&self) -> Result<Vec<WorkerRow>>;
    fn reap_dead_workers(&self) -> Result<Vec<String>>;
    fn unregister_worker(&self, worker_id: &str) -> Result<()>;
    fn list_claims_by_worker(&self, worker_id: &str) -> Result<Vec<String>>;

    // ── Queue pause/resume ───────────────────────────────────────

    fn pause_queue(&self, queue_name: &str) -> Result<()>;
    fn resume_queue(&self, queue_name: &str) -> Result<()>;
    fn list_paused_queues(&self) -> Result<Vec<String>>;

    // ── Job expiry ───────────────────────────────────────────────

    fn expire_pending_jobs(&self, now: i64) -> Result<u64>;

    // ── Job revocation ───────────────────────────────────────────

    fn cancel_pending_by_queue(&self, queue: &str) -> Result<u64>;
    fn cancel_pending_by_task(&self, task_name: &str) -> Result<u64>;

    // ── Job archival ─────────────────────────────────────────────

    fn archive_old_jobs(&self, cutoff_ms: i64) -> Result<u64>;
    fn list_archived(&self, limit: i64, offset: i64) -> Result<Vec<Job>>;
    /// Keyset-paginated `list_archived`, ordered by `(completed_at, id)`
    /// descending. See [`Storage::list_jobs_after`] for the cursor contract.
    fn list_archived_after(&self, limit: i64, after: Option<(i64, &str)>) -> Result<Vec<Job>>;

    // ── Distributed locking ────────────────────────────────────

    fn acquire_lock(&self, lock_name: &str, owner_id: &str, ttl_ms: i64) -> Result<bool>;
    fn release_lock(&self, lock_name: &str, owner_id: &str) -> Result<bool>;
    fn extend_lock(&self, lock_name: &str, owner_id: &str, ttl_ms: i64) -> Result<bool>;
    fn get_lock_info(&self, lock_name: &str) -> Result<Option<LockInfoRow>>;
    fn reap_expired_locks(&self, now: i64) -> Result<u64>;

    // ── Execution claims (exactly-once) ────────────────────────

    fn claim_execution(&self, job_id: &str, worker_id: &str) -> Result<bool>;
    /// Batch variant of [`Storage::claim_execution`]: attempt to claim every
    /// `job_id` for `worker_id` in as few round trips as the backend allows.
    /// Returns one flag per input id, in order — `true` if this worker won the
    /// claim, `false` if a claim already existed.
    fn claim_execution_batch(&self, job_ids: &[&str], worker_id: &str) -> Result<Vec<bool>>;
    fn complete_execution(&self, job_id: &str) -> Result<()>;
    fn purge_execution_claims(&self, older_than_ms: i64) -> Result<u64>;
    /// Atomically transfer an existing claim from `expected_owner` to
    /// `new_owner`. Returns `true` only if the claim was held by
    /// `expected_owner` — the `job_id` PK serializes concurrent rescuers so
    /// exactly one wins.
    fn reclaim_execution(
        &self,
        job_id: &str,
        expected_owner: &str,
        new_owner: &str,
    ) -> Result<bool>;

    // ── Per-task concurrency ──────────────────────────────────────

    fn count_running_by_task(&self, task_name: &str) -> Result<i64>;

    // ── Per-queue stats ──────────────────────────────────────────

    fn stats_by_queue(&self, queue_name: &str) -> Result<QueueStats>;
    fn stats_all_queues(&self) -> Result<std::collections::HashMap<String, QueueStats>>;

    // ── Filtered job listing ─────────────────────────────────────

    #[allow(clippy::too_many_arguments)]
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
    ) -> Result<Vec<Job>>;

    /// Keyset-paginated `list_jobs_filtered`, ordered by `(created_at, id)`
    /// descending. See [`Storage::list_jobs_after`] for the cursor contract.
    #[allow(clippy::too_many_arguments)]
    fn list_jobs_filtered_after(
        &self,
        status: Option<i32>,
        queue_name: Option<&str>,
        task_name: Option<&str>,
        metadata_like: Option<&str>,
        error_like: Option<&str>,
        created_after: Option<i64>,
        created_before: Option<i64>,
        limit: i64,
        after: Option<(i64, &str)>,
        namespace: Option<&str>,
    ) -> Result<Vec<Job>>;

    // ── Dashboard settings (key/value store) ─────────────────────

    /// Fetch a single setting value by key, or ``None`` if unset.
    fn get_setting(&self, key: &str) -> Result<Option<String>>;
    /// Insert or update a setting.
    fn set_setting(&self, key: &str, value: &str) -> Result<()>;
    /// Delete a setting. Returns ``true`` if a row was removed.
    fn delete_setting(&self, key: &str) -> Result<bool>;
    /// Return all settings as a key→value map.
    fn list_settings(&self) -> Result<std::collections::HashMap<String, String>>;
}
