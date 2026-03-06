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

/// Delay before re-scheduling a circuit-broken job (ms).
const CIRCUIT_BREAKER_RETRY_DELAY_MS: i64 = 5000;

/// Delay before re-scheduling a rate-limited job (ms).
const RATE_LIMIT_RETRY_DELAY_MS: i64 = 1000;

/// Default max retries for periodic tasks.
const PERIODIC_DEFAULT_MAX_RETRIES: i32 = 3;

/// Default timeout for periodic tasks (ms).
const PERIODIC_DEFAULT_TIMEOUT_MS: i64 = 300_000;

/// Configuration for the scheduler's timing and behavior.
#[derive(Debug, Clone)]
pub struct SchedulerConfig {
    /// Interval between scheduler poll cycles.
    pub poll_interval: Duration,
    /// Reap stale jobs every N iterations.
    pub reap_interval: u32,
    /// Check periodic tasks every N iterations.
    pub periodic_check_interval: u32,
    /// Auto-cleanup old jobs every N iterations.
    pub cleanup_interval: u32,
    /// TTL for job results in milliseconds. None means no auto-cleanup.
    pub result_ttl_ms: Option<i64>,
}

impl Default for SchedulerConfig {
    fn default() -> Self {
        Self {
            poll_interval: Duration::from_millis(50),
            reap_interval: 100,
            periodic_check_interval: 60,
            cleanup_interval: 1200,
            result_ttl_ms: None,
        }
    }
}

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
    config: SchedulerConfig,
    shutdown: Arc<Notify>,
}

/// Counters for tick-based scheduling of periodic maintenance tasks.
#[derive(Default)]
struct TickCounters {
    reap: u32,
    periodic: u32,
    cleanup: u32,
}

impl Scheduler {
    pub fn new(storage: SqliteStorage, queues: Vec<String>, config: SchedulerConfig) -> Self {
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
            config,
            shutdown: Arc::new(Notify::new()),
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
        let mut counters = TickCounters::default();

        loop {
            tokio::select! {
                _ = self.shutdown.notified() => break,
                _ = tokio::time::sleep(self.config.poll_interval) => {}
            }

            self.tick(&job_tx, &mut counters);
        }
    }

    /// Execute one iteration of the scheduler loop.
    fn tick(&self, job_tx: &Sender<Job>, counters: &mut TickCounters) {
        if let Err(e) = self.try_dispatch(job_tx) {
            error!("scheduler error: {e}");
        }

        counters.reap += 1;
        counters.periodic += 1;
        counters.cleanup += 1;

        if counters.reap.is_multiple_of(self.config.reap_interval) {
            if let Err(e) = self.reap_stale() {
                error!("reap error: {e}");
            }
        }

        if counters.periodic.is_multiple_of(self.config.periodic_check_interval) {
            if let Err(e) = self.check_periodic() {
                error!("periodic check error: {e}");
            }
        }

        if counters.cleanup.is_multiple_of(self.config.cleanup_interval) {
            if let Err(e) = self.auto_cleanup() {
                error!("auto-cleanup error: {e}");
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
        let ttl = match self.config.result_ttl_ms {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::job::JobStatus;
    use crate::storage::models::NewPeriodicTaskRow;

    fn test_scheduler() -> Scheduler {
        let storage = SqliteStorage::in_memory().unwrap();
        Scheduler::new(
            storage,
            vec!["default".to_string()],
            SchedulerConfig::default(),
        )
    }

    fn make_job(task_name: &str) -> NewJob {
        NewJob {
            queue: "default".to_string(),
            task_name: task_name.to_string(),
            payload: vec![1, 2, 3],
            priority: 0,
            scheduled_at: now_millis(),
            max_retries: 3,
            timeout_ms: 300_000,
            unique_key: None,
            metadata: None,
            depends_on: vec![],
            expires_at: None,
            result_ttl_ms: None,
        }
    }

    /// Enqueue a job and dequeue it so it's in Running state.
    fn enqueue_and_run(scheduler: &Scheduler, task_name: &str) -> Job {
        let job = scheduler.storage.enqueue(make_job(task_name)).unwrap();
        let (tx, _rx) = crossbeam_channel::unbounded();
        let mut counters = TickCounters::default();
        scheduler.tick(&tx, &mut counters);
        scheduler.storage.get_job(&job.id).unwrap().unwrap()
    }

    #[test]
    fn test_handle_success() {
        let scheduler = test_scheduler();
        let job = enqueue_and_run(&scheduler, "success_task");
        assert_eq!(job.status, JobStatus::Running);

        scheduler.handle_result(JobResult::Success {
            job_id: job.id.clone(),
            result: Some(vec![42]),
            task_name: "success_task".to_string(),
            wall_time_ns: 1_000_000,
        }).unwrap();

        let completed = scheduler.storage.get_job(&job.id).unwrap().unwrap();
        assert_eq!(completed.status, JobStatus::Complete);
        assert_eq!(completed.result, Some(vec![42]));
    }

    #[test]
    fn test_handle_failure_with_retry() {
        let mut scheduler = test_scheduler();
        scheduler.register_task("retry_task".to_string(), TaskConfig {
            retry_policy: RetryPolicy {
                max_retries: 3,
                base_delay_ms: 100,
                max_delay_ms: 1000,
            },
            rate_limit: None,
            circuit_breaker: None,
        });

        let job = enqueue_and_run(&scheduler, "retry_task");

        scheduler.handle_result(JobResult::Failure {
            job_id: job.id.clone(),
            error: "transient error".to_string(),
            retry_count: 0,
            max_retries: 3,
            task_name: "retry_task".to_string(),
            wall_time_ns: 500_000,
            should_retry: true,
        }).unwrap();

        let retried = scheduler.storage.get_job(&job.id).unwrap().unwrap();
        assert_eq!(retried.status, JobStatus::Pending);
        assert_eq!(retried.retry_count, 1);
    }

    #[test]
    fn test_handle_failure_exhausted() {
        let scheduler = test_scheduler();
        let job = enqueue_and_run(&scheduler, "exhausted_task");

        scheduler.handle_result(JobResult::Failure {
            job_id: job.id.clone(),
            error: "fatal".to_string(),
            retry_count: 3,
            max_retries: 3,
            task_name: "exhausted_task".to_string(),
            wall_time_ns: 100,
            should_retry: true,
        }).unwrap();

        let dead = scheduler.storage.get_job(&job.id).unwrap().unwrap();
        assert_eq!(dead.status, JobStatus::Dead);

        let dlq = scheduler.storage.list_dead(10, 0).unwrap();
        assert_eq!(dlq.len(), 1);
        assert_eq!(dlq[0].original_job_id, job.id);
    }

    #[test]
    fn test_handle_failure_no_retry() {
        let scheduler = test_scheduler();
        let job = enqueue_and_run(&scheduler, "no_retry_task");

        scheduler.handle_result(JobResult::Failure {
            job_id: job.id.clone(),
            error: "non-retryable".to_string(),
            retry_count: 0,
            max_retries: 3,
            task_name: "no_retry_task".to_string(),
            wall_time_ns: 100,
            should_retry: false,
        }).unwrap();

        let dead = scheduler.storage.get_job(&job.id).unwrap().unwrap();
        assert_eq!(dead.status, JobStatus::Dead);
    }

    #[test]
    fn test_handle_cancelled() {
        let scheduler = test_scheduler();
        let job = enqueue_and_run(&scheduler, "cancel_task");

        scheduler.handle_result(JobResult::Cancelled {
            job_id: job.id.clone(),
            task_name: "cancel_task".to_string(),
            wall_time_ns: 100,
        }).unwrap();

        let cancelled = scheduler.storage.get_job(&job.id).unwrap().unwrap();
        assert_eq!(cancelled.status, JobStatus::Cancelled);
    }

    #[test]
    fn test_try_dispatch_rate_limited() {
        let mut scheduler = test_scheduler();
        scheduler.register_task("rl_task".to_string(), TaskConfig {
            retry_policy: RetryPolicy::default(),
            rate_limit: Some(RateLimitConfig { max_tokens: 1.0, refill_rate: 0.0 }),
            circuit_breaker: None,
        });

        // Enqueue two jobs
        scheduler.storage.enqueue(make_job("rl_task")).unwrap();
        scheduler.storage.enqueue(make_job("rl_task")).unwrap();

        let (tx, rx) = crossbeam_channel::unbounded();
        let mut counters = TickCounters::default();

        // First tick should dispatch (consumes the one token)
        scheduler.tick(&tx, &mut counters);
        assert_eq!(rx.len(), 1);

        // Second tick: job dequeued but rate limited, rescheduled
        scheduler.tick(&tx, &mut counters);
        assert_eq!(rx.len(), 1); // still just 1 dispatched

        // The second job should be back in pending with a future scheduled_at
        let jobs = scheduler.storage.list_jobs(
            Some(JobStatus::Pending as i32), None, None, 10, 0
        ).unwrap();
        assert_eq!(jobs.len(), 1);
        assert!(jobs[0].scheduled_at > now_millis());
    }

    #[test]
    fn test_try_dispatch_circuit_broken() {
        let mut scheduler = test_scheduler();
        let cb_config = CircuitBreakerConfig {
            threshold: 1,
            window_ms: 60_000,
            cooldown_ms: 300_000,
        };
        scheduler.register_task("cb_task".to_string(), TaskConfig {
            retry_policy: RetryPolicy::default(),
            rate_limit: None,
            circuit_breaker: Some(cb_config),
        });

        // Trip the circuit breaker
        scheduler.circuit_breaker.record_failure("cb_task").unwrap();

        scheduler.storage.enqueue(make_job("cb_task")).unwrap();

        let (tx, rx) = crossbeam_channel::unbounded();
        let mut counters = TickCounters::default();
        scheduler.tick(&tx, &mut counters);

        // Job should not be dispatched (circuit is open)
        assert_eq!(rx.len(), 0);

        // Job should be rescheduled
        let jobs = scheduler.storage.list_jobs(
            Some(JobStatus::Pending as i32), None, None, 10, 0
        ).unwrap();
        assert_eq!(jobs.len(), 1);
        assert!(jobs[0].scheduled_at > now_millis());
    }

    #[test]
    fn test_reap_stale_jobs() {
        let mut scheduler = test_scheduler();
        scheduler.register_task("stale_task".to_string(), TaskConfig {
            retry_policy: RetryPolicy { max_retries: 3, base_delay_ms: 100, max_delay_ms: 1000 },
            rate_limit: None,
            circuit_breaker: None,
        });

        // Create a job with a very short timeout
        let mut new_job = make_job("stale_task");
        new_job.timeout_ms = 1; // 1ms timeout
        let job = scheduler.storage.enqueue(new_job).unwrap();

        // Dequeue it (sets it to Running with started_at)
        let (tx, _rx) = crossbeam_channel::unbounded();
        let mut counters = TickCounters::default();
        scheduler.tick(&tx, &mut counters);

        // Wait for it to "time out"
        std::thread::sleep(Duration::from_millis(10));

        // Reap should find and handle it
        scheduler.reap_stale().unwrap();

        let reaped = scheduler.storage.get_job(&job.id).unwrap().unwrap();
        // It should be rescheduled for retry (retry_count < max_retries)
        assert_eq!(reaped.status, JobStatus::Pending);
        assert_eq!(reaped.retry_count, 1);
    }

    #[test]
    fn test_check_periodic() {
        let scheduler = test_scheduler();

        // Register a periodic task that's due now
        let now = now_millis();
        let row = NewPeriodicTaskRow {
            name: "every_minute",
            task_name: "periodic_task",
            cron_expr: "* * * * * *", // every second
            args: None,
            kwargs: None,
            queue: "default",
            enabled: true,
            next_run: now - 1000, // due 1 second ago
        };
        scheduler.storage.register_periodic(&row).unwrap();

        scheduler.check_periodic().unwrap();

        // A job should have been enqueued
        let jobs = scheduler.storage.list_jobs(
            Some(JobStatus::Pending as i32), None, Some("periodic_task"), 10, 0
        ).unwrap();
        assert_eq!(jobs.len(), 1);
    }

    #[test]
    fn test_auto_cleanup() {
        let storage = SqliteStorage::in_memory().unwrap();
        let config = SchedulerConfig {
            result_ttl_ms: Some(1), // 1ms TTL
            ..SchedulerConfig::default()
        };
        let scheduler = Scheduler::new(
            storage, vec!["default".to_string()], config,
        );

        // Enqueue, dequeue, and complete a job
        let job = scheduler.storage.enqueue(make_job("cleanup_task")).unwrap();
        scheduler.storage.dequeue("default", now_millis() + 1000).unwrap();
        scheduler.storage.complete(&job.id, Some(vec![1])).unwrap();

        // Wait for the TTL to expire
        std::thread::sleep(Duration::from_millis(10));

        scheduler.auto_cleanup().unwrap();

        // Job should be purged
        let fetched = scheduler.storage.get_job(&job.id).unwrap();
        assert!(fetched.is_none());
    }

    #[test]
    fn test_tick_dispatches_and_maintains() {
        let storage = SqliteStorage::in_memory().unwrap();
        let config = SchedulerConfig {
            reap_interval: 1,
            periodic_check_interval: 1,
            cleanup_interval: 1,
            ..SchedulerConfig::default()
        };
        let scheduler = Scheduler::new(
            storage, vec!["default".to_string()], config,
        );

        scheduler.storage.enqueue(make_job("tick_task")).unwrap();

        let (tx, rx) = crossbeam_channel::unbounded();
        let mut counters = TickCounters::default();
        scheduler.tick(&tx, &mut counters);

        // Job should be dispatched
        assert_eq!(rx.len(), 1);
        // Counters should be incremented
        assert_eq!(counters.reap, 1);
        assert_eq!(counters.periodic, 1);
        assert_eq!(counters.cleanup, 1);
    }
}
