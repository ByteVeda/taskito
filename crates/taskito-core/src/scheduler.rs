use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use crossbeam_channel::Sender;
use log::{error, info, warn};
use tokio::sync::Notify;

use crate::resilience::circuit_breaker::{CircuitBreaker, CircuitBreakerConfig};
use crate::resilience::dlq::DeadLetterQueue;
use crate::error::Result;
use crate::job::{Job, NewJob, now_millis};
use crate::periodic::next_cron_time;
use crate::resilience::rate_limiter::{RateLimitConfig, RateLimiter};
use crate::resilience::retry::RetryPolicy;
use crate::storage::sqlite::SqliteStorage;

/// Default interval between scheduler poll cycles.
const POLL_INTERVAL: Duration = Duration::from_millis(50);

/// Reap stale jobs every ~100 iterations (~5s at default poll interval).
const REAP_INTERVAL: u32 = 100;

/// Check periodic tasks every ~60 iterations (~3s at default poll interval).
const PERIODIC_CHECK_INTERVAL: u32 = 60;

/// Auto-cleanup old jobs every ~1200 iterations (~60s at default poll interval).
const CLEANUP_INTERVAL: u32 = 1200;

/// Delay before re-scheduling a circuit-broken job (ms).
const CIRCUIT_BREAKER_RETRY_DELAY_MS: i64 = 5000;

/// Delay before re-scheduling a rate-limited job (ms).
const RATE_LIMIT_RETRY_DELAY_MS: i64 = 1000;

/// Default max retries for periodic tasks.
const PERIODIC_DEFAULT_MAX_RETRIES: i32 = 3;

/// Default timeout for periodic tasks (ms).
const PERIODIC_DEFAULT_TIMEOUT_MS: i64 = 300_000;

/// Result of executing a job (sent back from worker threads).
pub enum JobResult {
    Success {
        job_id: String,
        result: Option<Vec<u8>>,
        task_name: String,
        wall_time_ns: i64,
    },
    Failure {
        job_id: String,
        error: String,
        retry_count: i32,
        max_retries: i32,
        task_name: String,
        wall_time_ns: i64,
        should_retry: bool,
    },
    Cancelled {
        job_id: String,
        task_name: String,
        wall_time_ns: i64,
    },
}

/// Per-task configuration for retry, rate limiting, and circuit breaker.
#[derive(Debug, Clone)]
pub struct TaskConfig {
    pub retry_policy: RetryPolicy,
    pub rate_limit: Option<RateLimitConfig>,
    pub circuit_breaker: Option<CircuitBreakerConfig>,
}

/// The central scheduler that coordinates job dispatch, retries, rate limiting, and circuit breakers.
pub struct Scheduler {
    storage: SqliteStorage,
    rate_limiter: RateLimiter,
    dlq: DeadLetterQueue,
    circuit_breaker: CircuitBreaker,
    task_configs: HashMap<String, TaskConfig>,
    queues: Vec<String>,
    poll_interval: Duration,
    shutdown: Arc<Notify>,
    result_ttl_ms: Option<i64>,
}

impl Scheduler {
    pub fn new(storage: SqliteStorage, queues: Vec<String>, result_ttl_ms: Option<i64>) -> Self {
        let rate_limiter = RateLimiter::new(storage.clone());
        let dlq = DeadLetterQueue::new(storage.clone());
        let circuit_breaker = CircuitBreaker::new(storage.clone());

        Self {
            storage,
            rate_limiter,
            dlq,
            circuit_breaker,
            task_configs: HashMap::new(),
            queues,
            poll_interval: POLL_INTERVAL,
            shutdown: Arc::new(Notify::new()),
            result_ttl_ms,
        }
    }

    pub fn storage(&self) -> &SqliteStorage {
        &self.storage
    }

    pub fn shutdown_handle(&self) -> Arc<Notify> {
        self.shutdown.clone()
    }

    pub fn register_task(&mut self, task_name: String, config: TaskConfig) {
        if let Some(ref cb_config) = config.circuit_breaker {
            if let Err(e) = self.circuit_breaker.register(&task_name, cb_config) {
                error!("failed to register circuit breaker for {task_name}: {e}");
            }
        }
        self.task_configs.insert(task_name, config);
    }

    pub fn circuit_breaker(&self) -> &CircuitBreaker {
        &self.circuit_breaker
    }

    /// Run the scheduler loop. Polls for ready jobs and dispatches them
    /// to the worker pool via the provided channel.
    pub async fn run(&self, job_tx: Sender<Job>) {
        let mut reap_counter = 0u32;
        let mut periodic_counter = 0u32;
        let mut cleanup_counter = 0u32;

        loop {
            // Check for shutdown
            tokio::select! {
                _ = self.shutdown.notified() => {
                    break;
                }
                _ = tokio::time::sleep(self.poll_interval) => {}
            }

            // Try to dequeue and dispatch a job
            match self.try_dispatch(&job_tx) {
                Ok(_dispatched) => {}
                Err(e) => {
                    error!("scheduler error: {e}");
                }
            }

            reap_counter += 1;
            periodic_counter += 1;
            cleanup_counter += 1;

            if reap_counter.is_multiple_of(REAP_INTERVAL) {
                if let Err(e) = self.reap_stale() {
                    error!("reap error: {e}");
                }
            }

            if periodic_counter.is_multiple_of(PERIODIC_CHECK_INTERVAL) {
                if let Err(e) = self.check_periodic() {
                    error!("periodic check error: {e}");
                }
            }

            if cleanup_counter.is_multiple_of(CLEANUP_INTERVAL) {
                if let Err(e) = self.auto_cleanup() {
                    error!("auto-cleanup error: {e}");
                }
            }
        }
    }

    fn try_dispatch(&self, job_tx: &Sender<Job>) -> Result<bool> {
        let now = now_millis();

        let job = match self.storage.dequeue_from(&self.queues, now)? {
            Some(j) => j,
            None => return Ok(false),
        };

        // Check circuit breaker for this task
        if let Some(config) = self.task_configs.get(&job.task_name) {
            if config.circuit_breaker.is_some()
                && !self.circuit_breaker.allow(&job.task_name)?
            {
                self.storage.retry(&job.id, now + CIRCUIT_BREAKER_RETRY_DELAY_MS)?;
                return Ok(false);
            }

            if let Some(ref rl_config) = config.rate_limit {
                if !self.rate_limiter.try_acquire(&job.task_name, rl_config)? {
                    self.storage.retry(&job.id, now + RATE_LIMIT_RETRY_DELAY_MS)?;
                    return Ok(false);
                }
            }
        }

        // Dispatch to worker pool
        if job_tx.send(job).is_err() {
            warn!("worker channel closed");
        }

        Ok(true)
    }

    /// Handle a completed or failed job result from a worker.
    pub fn handle_result(&self, result: JobResult) -> Result<()> {
        match result {
            JobResult::Success { job_id, result, ref task_name, wall_time_ns } => {
                self.storage.complete(&job_id, result)?;

                if let Err(e) = self.storage.record_metric(task_name, &job_id, wall_time_ns, 0, true) {
                    error!("failed to record metric for job {job_id}: {e}");
                }

                if let Err(e) = self.circuit_breaker.record_success(task_name) {
                    error!("circuit breaker error for {task_name}: {e}");
                }
            }
            JobResult::Failure {
                job_id,
                error,
                retry_count,
                max_retries,
                task_name,
                wall_time_ns,
                should_retry,
            } => {
                if let Err(e) = self.storage.record_error(&job_id, retry_count, &error) {
                    log::error!("failed to record error for job {job_id}: {e}");
                }

                if let Err(e) = self.storage.record_metric(&task_name, &job_id, wall_time_ns, 0, false) {
                    log::error!("failed to record metric for job {job_id}: {e}");
                }

                if let Err(e) = self.circuit_breaker.record_failure(&task_name) {
                    log::error!("circuit breaker error for {task_name}: {e}");
                }

                // If should_retry is false (exception filtering), skip straight to DLQ
                if !should_retry {
                    if let Some(job) = self.storage.get_job(&job_id)? {
                        self.dlq.move_to_dlq(&job, &error, None)?;
                    }
                    return Ok(());
                }

                let policy = self
                    .task_configs
                    .get(&task_name)
                    .map(|c| c.retry_policy.clone())
                    .unwrap_or_default();

                let effective_max = if max_retries > 0 {
                    max_retries
                } else {
                    policy.max_retries
                };

                if retry_count < effective_max {
                    let next_at = policy.next_retry_at(retry_count);
                    self.storage.retry(&job_id, next_at)?;
                } else {
                    // Move to DLQ
                    if let Some(job) = self.storage.get_job(&job_id)? {
                        self.dlq.move_to_dlq(&job, &error, None)?;
                    }
                }
            }
            JobResult::Cancelled { job_id, task_name, wall_time_ns } => {
                // Mark as cancelled, no retry
                if let Err(e) = self.storage.mark_cancelled(&job_id) {
                    error!("failed to mark job {job_id} as cancelled: {e}");
                }
                if let Err(e) = self.storage.record_metric(&task_name, &job_id, wall_time_ns, 0, false) {
                    error!("failed to record metric for cancelled job {job_id}: {e}");
                }
            }
        }
        Ok(())
    }

    fn reap_stale(&self) -> Result<()> {
        let now = now_millis();
        let stale_jobs = self.storage.reap_stale_jobs(now)?;

        for job in stale_jobs {
            let error = format!("job timed out after {}ms", job.timeout_ms);
            let _ = self.storage.fail(&job.id, &error);
            self.handle_result(JobResult::Failure {
                job_id: job.id.clone(),
                error,
                retry_count: job.retry_count,
                max_retries: job.max_retries,
                task_name: job.task_name.clone(),
                wall_time_ns: 0,
                should_retry: true,
            })?;
        }

        Ok(())
    }

    /// Purge old completed/dead jobs and their errors if result_ttl_ms is set.
    fn auto_cleanup(&self) -> Result<()> {
        let ttl = match self.result_ttl_ms {
            Some(t) => t,
            None => return Ok(()),
        };

        let cutoff = now_millis() - ttl;

        // Use per-job TTL aware cleanup
        let completed = self.storage.purge_completed_with_ttl(cutoff)?;
        let dead = self.storage.purge_dead(cutoff)?;
        let errors = self.storage.purge_job_errors(cutoff)?;
        let metrics = self.storage.purge_metrics(cutoff).unwrap_or(0);
        let logs = self.storage.purge_task_logs(cutoff).unwrap_or(0);

        if completed + dead + errors + metrics + logs > 0 {
            info!(
                "auto-cleanup: purged {completed} completed, {dead} dead, {errors} errors, {metrics} metrics, {logs} logs"
            );
        }

        Ok(())
    }

    /// Check for periodic tasks that are due and enqueue them.
    fn check_periodic(&self) -> Result<()> {
        let now = now_millis();
        let due_tasks = self.storage.get_due_periodic(now)?;

        for task in due_tasks {
            let new_job = NewJob {
                queue: task.queue.clone(),
                task_name: task.task_name.clone(),
                payload: Self::build_periodic_payload(&task.args, &task.kwargs),
                priority: 0,
                scheduled_at: now,
                max_retries: PERIODIC_DEFAULT_MAX_RETRIES,
                timeout_ms: PERIODIC_DEFAULT_TIMEOUT_MS,
                unique_key: None,
                metadata: None,
                depends_on: vec![],
                expires_at: None,
                result_ttl_ms: None,
            };

            if let Err(e) = self.storage.enqueue(new_job) {
                error!("failed to enqueue periodic task '{}': {e}", task.name);
                continue;
            }

            let next_run = match next_cron_time(&task.cron_expr, now) {
                Ok(t) => t,
                Err(e) => {
                    error!(
                        "failed to compute next run for '{}': {e}",
                        task.name
                    );
                    continue;
                }
            };

            if let Err(e) = self.storage.update_periodic_schedule(&task.name, now, next_run) {
                error!(
                    "failed to update schedule for '{}': {e}",
                    task.name
                );
            }
        }

        Ok(())
    }

    /// Build a cloudpickle-compatible payload from stored args/kwargs.
    fn build_periodic_payload(args: &Option<Vec<u8>>, _kwargs: &Option<Vec<u8>>) -> Vec<u8> {
        match args {
            Some(blob) => blob.clone(),
            None => Vec::new(),
        }
    }
}
