use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use crossbeam_channel::Sender;
use tokio::sync::Notify;

use crate::dlq::DeadLetterQueue;
use crate::error::Result;
use crate::job::{Job, NewJob, now_millis};
use crate::periodic::next_cron_time;
use crate::rate_limiter::{RateLimitConfig, RateLimiter};
use crate::retry::RetryPolicy;
use crate::storage::sqlite::SqliteStorage;

/// Result of executing a job (sent back from worker threads).
pub enum JobResult {
    Success {
        job_id: String,
        result: Option<Vec<u8>>,
    },
    Failure {
        job_id: String,
        error: String,
        retry_count: i32,
        max_retries: i32,
        task_name: String,
    },
}

/// Per-task configuration for retry and rate limiting.
#[derive(Debug, Clone)]
pub struct TaskConfig {
    pub retry_policy: RetryPolicy,
    pub rate_limit: Option<RateLimitConfig>,
}

/// The central scheduler that coordinates job dispatch, retries, and rate limiting.
pub struct Scheduler {
    storage: SqliteStorage,
    rate_limiter: RateLimiter,
    dlq: DeadLetterQueue,
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

        Self {
            storage,
            rate_limiter,
            dlq,
            task_configs: HashMap::new(),
            queues,
            poll_interval: Duration::from_millis(50),
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
        self.task_configs.insert(task_name, config);
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
                Ok(dispatched) => {
                    if !dispatched {
                        // No jobs ready — sleep a bit longer next iteration
                        // (poll_interval handles this)
                    }
                }
                Err(e) => {
                    eprintln!("[quickq] scheduler error: {e}");
                }
            }

            reap_counter += 1;
            periodic_counter += 1;
            cleanup_counter += 1;

            // Periodically reap stale jobs (every ~100 iterations = ~5s)
            if reap_counter % 100 == 0 {
                if let Err(e) = self.reap_stale() {
                    eprintln!("[quickq] reap error: {e}");
                }
            }

            // Check periodic tasks (every ~60 iterations = ~3s)
            if periodic_counter % 60 == 0 {
                if let Err(e) = self.check_periodic() {
                    eprintln!("[quickq] periodic check error: {e}");
                }
            }

            // Auto-cleanup old completed/dead jobs (every ~1200 iterations = ~60s)
            if cleanup_counter % 1200 == 0 {
                if let Err(e) = self.auto_cleanup() {
                    eprintln!("[quickq] auto-cleanup error: {e}");
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

        // Check rate limit for this task
        if let Some(config) = self.task_configs.get(&job.task_name) {
            if let Some(ref rl_config) = config.rate_limit {
                if !self.rate_limiter.try_acquire(&job.task_name, rl_config)? {
                    // Rate limited — re-schedule for shortly in the future
                    self.storage.retry(&job.id, now + 1000)?;
                    return Ok(false);
                }
            }
        }

        // Dispatch to worker pool
        if job_tx.send(job).is_err() {
            eprintln!("[quickq] worker channel closed");
        }

        Ok(true)
    }

    /// Handle a completed or failed job result from a worker.
    pub fn handle_result(&self, result: JobResult) -> Result<()> {
        match result {
            JobResult::Success { job_id, result } => {
                self.storage.complete(&job_id, result)?;
            }
            JobResult::Failure {
                job_id,
                error,
                retry_count,
                max_retries,
                task_name,
            } => {
                // Record the error for this attempt
                if let Err(e) = self.storage.record_error(&job_id, retry_count, &error) {
                    eprintln!("[quickq] failed to record error for job {job_id}: {e}");
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
        }
        Ok(())
    }

    fn reap_stale(&self) -> Result<()> {
        let now = now_millis();
        let stale_jobs = self.storage.reap_stale_jobs(now)?;

        for job in stale_jobs {
            let error = format!("job timed out after {}ms", job.timeout_ms);
            // Mark as failed first
            let _ = self.storage.fail(&job.id, &error);
            // Then handle retry/DLQ logic
            self.handle_result(JobResult::Failure {
                job_id: job.id.clone(),
                error,
                retry_count: job.retry_count,
                max_retries: job.max_retries,
                task_name: job.task_name.clone(),
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
        let completed = self.storage.purge_completed(cutoff)?;
        let dead = self.storage.purge_dead(cutoff)?;
        let errors = self.storage.purge_job_errors(cutoff)?;

        if completed + dead + errors > 0 {
            eprintln!(
                "[quickq] auto-cleanup: purged {completed} completed, {dead} dead, {errors} error records"
            );
        }

        Ok(())
    }

    /// Check for periodic tasks that are due and enqueue them.
    fn check_periodic(&self) -> Result<()> {
        let now = now_millis();
        let due_tasks = self.storage.get_due_periodic(now)?;

        for task in due_tasks {
            // Enqueue a job for this periodic task
            let new_job = NewJob {
                queue: task.queue.clone(),
                task_name: task.task_name.clone(),
                payload: Self::build_periodic_payload(&task.args, &task.kwargs),
                priority: 0,
                scheduled_at: now,
                max_retries: 3,
                timeout_ms: 300_000,
                unique_key: None,
                metadata: None,
            };

            if let Err(e) = self.storage.enqueue(new_job) {
                eprintln!("[quickq] failed to enqueue periodic task '{}': {e}", task.name);
                continue;
            }

            // Compute next run time
            let next_run = match next_cron_time(&task.cron_expr, now) {
                Ok(t) => t,
                Err(e) => {
                    eprintln!(
                        "[quickq] failed to compute next run for '{}': {e}",
                        task.name
                    );
                    continue;
                }
            };

            if let Err(e) = self.storage.update_periodic_schedule(&task.name, now, next_run) {
                eprintln!(
                    "[quickq] failed to update schedule for '{}': {e}",
                    task.name
                );
            }
        }

        Ok(())
    }

    /// Build a cloudpickle-compatible payload from stored args/kwargs.
    /// If both are None, returns an empty tuple payload.
    fn build_periodic_payload(args: &Option<Vec<u8>>, _kwargs: &Option<Vec<u8>>) -> Vec<u8> {
        // The args and kwargs are stored as pre-pickled blobs from Python.
        // We need to combine them into the (args, kwargs) tuple format.
        // If they were stored as None, we use empty tuple/dict from cloudpickle.
        // Since we can't easily construct Python pickle in Rust, the Python
        // layer stores the full (args, kwargs) tuple as the args blob.
        // So if args blob exists, use it directly as the payload.
        match args {
            Some(blob) => blob.clone(),
            None => {
                // Empty payload: cloudpickle.dumps(((), {}))
                // This is a well-known pickle byte sequence for ((), {})
                // We'll store the full payload in the `args` column from Python.
                Vec::new()
            }
        }
    }
}
