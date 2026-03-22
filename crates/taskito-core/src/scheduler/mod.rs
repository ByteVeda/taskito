mod maintenance;
mod poller;
mod result_handler;

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use log::error;
use tokio::sync::Notify;

use crate::resilience::circuit_breaker::{CircuitBreaker, CircuitBreakerConfig};
use crate::resilience::dlq::DeadLetterQueue;
use crate::resilience::rate_limiter::RateLimiter;
use crate::resilience::retry::RetryPolicy;
use crate::storage::StorageBackend;

pub use crate::job::Job;

/// Configuration for the scheduler's timing and behavior.
#[derive(Debug, Clone)]
pub struct SchedulerConfig {
    /// Interval between scheduler poll cycles.
    pub poll_interval: Duration,
    /// Priority boost per second of wait time. `None` disables aging.
    /// Example: `Some(1)` boosts priority by 1 per second of wait.
    pub aging_factor: Option<i64>,
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
            aging_factor: None,
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
        timed_out: bool,
    },
    Cancelled {
        job_id: String,
        task_name: String,
        wall_time_ns: i64,
    },
}

/// Outcome of processing a job result, returned to the caller for
/// Python-side middleware hook dispatch.
#[derive(Debug, Clone)]
pub enum ResultOutcome {
    /// Task completed successfully.
    Success { job_id: String, task_name: String },
    /// Task failed and will be retried.
    Retry {
        job_id: String,
        task_name: String,
        queue: String,
        error: String,
        retry_count: i32,
        timed_out: bool,
    },
    /// Task exhausted retries and moved to the dead-letter queue.
    DeadLettered {
        job_id: String,
        task_name: String,
        queue: String,
        error: String,
        timed_out: bool,
    },
    /// Task was cancelled during execution.
    Cancelled {
        job_id: String,
        task_name: String,
        queue: String,
    },
}

/// Per-task configuration for retry, rate limiting, and circuit breaker.
#[derive(Debug, Clone)]
pub struct TaskConfig {
    pub retry_policy: RetryPolicy,
    pub rate_limit: Option<crate::resilience::rate_limiter::RateLimitConfig>,
    pub circuit_breaker: Option<CircuitBreakerConfig>,
    pub max_concurrent: Option<i32>,
}

/// Per-queue configuration for rate limiting and concurrency caps.
#[derive(Debug, Clone)]
pub struct QueueConfig {
    pub rate_limit: Option<crate::resilience::rate_limiter::RateLimitConfig>,
    pub max_concurrent: Option<i32>,
}

/// In-memory cache of average task execution duration.
/// Updated on every `handle_result()` — no DB queries needed.
struct TaskDurationCache {
    durations: HashMap<String, (u64, i64)>, // (count, sum_ns)
}

impl TaskDurationCache {
    fn new() -> Self {
        Self {
            durations: HashMap::new(),
        }
    }

    fn record(&mut self, task_name: &str, wall_time_ns: i64) {
        let entry = self.durations.entry(task_name.to_string()).or_default();
        entry.0 += 1;
        entry.1 = entry.1.saturating_add(wall_time_ns);
    }

    #[allow(dead_code)]
    fn avg_ns(&self, task_name: &str) -> Option<i64> {
        self.durations
            .get(task_name)
            .filter(|(count, _)| *count > 0)
            .map(|(count, sum)| sum / *count as i64)
    }
}

/// The central scheduler that coordinates job dispatch, retries, rate limiting, and circuit breakers.
pub struct Scheduler {
    storage: StorageBackend,
    rate_limiter: RateLimiter,
    dlq: DeadLetterQueue,
    circuit_breaker: CircuitBreaker,
    task_configs: HashMap<String, TaskConfig>,
    queue_configs: HashMap<String, QueueConfig>,
    queues: Vec<String>,
    config: SchedulerConfig,
    shutdown: Arc<Notify>,
    paused_cache: Mutex<(HashSet<String>, Instant)>,
    namespace: Option<String>,
    duration_cache: Mutex<TaskDurationCache>,
}

/// Counters for tick-based scheduling of periodic maintenance tasks.
#[derive(Default)]
struct TickCounters {
    reap: u32,
    periodic: u32,
    cleanup: u32,
}

impl Scheduler {
    pub fn new(
        storage: StorageBackend,
        queues: Vec<String>,
        config: SchedulerConfig,
        namespace: Option<String>,
    ) -> Self {
        let rate_limiter = RateLimiter::new(storage.clone());
        let dlq = DeadLetterQueue::new(storage.clone());
        let circuit_breaker = CircuitBreaker::new(storage.clone());

        Self {
            storage,
            rate_limiter,
            dlq,
            circuit_breaker,
            task_configs: HashMap::new(),
            queue_configs: HashMap::new(),
            queues,
            config,
            shutdown: Arc::new(Notify::new()),
            paused_cache: Mutex::new((HashSet::new(), Instant::now())),
            namespace,
            duration_cache: Mutex::new(TaskDurationCache::new()),
        }
    }

    pub fn storage(&self) -> &StorageBackend {
        &self.storage
    }

    pub fn shutdown_handle(&self) -> Arc<Notify> {
        self.shutdown.clone()
    }

    pub fn register_queue_config(&mut self, queue_name: String, config: QueueConfig) {
        self.queue_configs.insert(queue_name, config);
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
    ///
    /// Uses adaptive polling: starts at `poll_interval`, backs off
    /// exponentially (up to 1s) when no jobs are found, resets immediately
    /// when a job is dispatched.
    pub async fn run(&self, job_tx: tokio::sync::mpsc::Sender<Job>) {
        let mut counters = TickCounters::default();
        let base_interval = self.config.poll_interval;
        let max_interval = Duration::from_secs(1);
        let mut current_interval = base_interval;

        loop {
            tokio::select! {
                _ = self.shutdown.notified() => break,
                _ = tokio::time::sleep(current_interval) => {}
            }

            let dispatched = self.tick(&job_tx, &mut counters);
            if dispatched {
                current_interval = base_interval;
            } else {
                current_interval = (current_interval * 2).min(max_interval);
            }
        }
    }

    /// Execute one iteration of the scheduler loop.
    /// Returns true if a job was dispatched.
    fn tick(&self, job_tx: &tokio::sync::mpsc::Sender<Job>, counters: &mut TickCounters) -> bool {
        let dispatched = match self.try_dispatch(job_tx) {
            Ok(d) => d,
            Err(e) => {
                error!("scheduler error: {e}");
                false
            }
        };

        counters.reap += 1;
        counters.periodic += 1;
        counters.cleanup += 1;

        if counters.reap.is_multiple_of(self.config.reap_interval) {
            if let Err(e) = self.reap_stale() {
                error!("reap error: {e}");
            }
        }

        if counters
            .periodic
            .is_multiple_of(self.config.periodic_check_interval)
        {
            if let Err(e) = self.check_periodic() {
                error!("periodic check error: {e}");
            }
        }

        if counters
            .cleanup
            .is_multiple_of(self.config.cleanup_interval)
        {
            if let Err(e) = self.auto_cleanup() {
                error!("auto-cleanup error: {e}");
            }
        }

        dispatched
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::job::{now_millis, JobStatus, NewJob};
    use crate::resilience::rate_limiter::RateLimitConfig;
    use crate::storage::models::NewPeriodicTaskRow;
    use crate::storage::Storage;

    fn test_scheduler() -> Scheduler {
        let storage =
            StorageBackend::Sqlite(crate::storage::sqlite::SqliteStorage::in_memory().unwrap());
        Scheduler::new(
            storage,
            vec!["default".to_string()],
            SchedulerConfig::default(),
            None,
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
            namespace: None,
        }
    }

    fn make_channel(
        cap: usize,
    ) -> (
        tokio::sync::mpsc::Sender<Job>,
        tokio::sync::mpsc::Receiver<Job>,
    ) {
        tokio::sync::mpsc::channel(cap)
    }

    /// Enqueue a job and dequeue it so it's in Running state.
    fn enqueue_and_run(scheduler: &Scheduler, task_name: &str) -> Job {
        let job = scheduler.storage.enqueue(make_job(task_name)).unwrap();
        let (tx, _rx) = make_channel(16);
        let mut counters = TickCounters::default();
        scheduler.tick(&tx, &mut counters);
        scheduler.storage.get_job(&job.id).unwrap().unwrap()
    }

    #[test]
    fn test_handle_success() {
        let scheduler = test_scheduler();
        let job = enqueue_and_run(&scheduler, "success_task");
        assert_eq!(job.status, JobStatus::Running);

        scheduler
            .handle_result(JobResult::Success {
                job_id: job.id.clone(),
                result: Some(vec![42]),
                task_name: "success_task".to_string(),
                wall_time_ns: 1_000_000,
            })
            .unwrap();

        let completed = scheduler.storage.get_job(&job.id).unwrap().unwrap();
        assert_eq!(completed.status, JobStatus::Complete);
        assert_eq!(completed.result, Some(vec![42]));
    }

    #[test]
    fn test_handle_failure_with_retry() {
        let mut scheduler = test_scheduler();
        scheduler.register_task(
            "retry_task".to_string(),
            TaskConfig {
                retry_policy: RetryPolicy {
                    max_retries: 3,
                    base_delay_ms: 100,
                    max_delay_ms: 1000,
                    custom_delays_ms: None,
                },
                rate_limit: None,
                circuit_breaker: None,
                max_concurrent: None,
            },
        );

        let job = enqueue_and_run(&scheduler, "retry_task");

        scheduler
            .handle_result(JobResult::Failure {
                job_id: job.id.clone(),
                error: "transient error".to_string(),
                retry_count: 0,
                max_retries: 3,
                task_name: "retry_task".to_string(),
                wall_time_ns: 500_000,
                should_retry: true,
                timed_out: false,
            })
            .unwrap();

        let retried = scheduler.storage.get_job(&job.id).unwrap().unwrap();
        assert_eq!(retried.status, JobStatus::Pending);
        assert_eq!(retried.retry_count, 1);
    }

    #[test]
    fn test_handle_failure_exhausted() {
        let scheduler = test_scheduler();
        let job = enqueue_and_run(&scheduler, "exhausted_task");

        scheduler
            .handle_result(JobResult::Failure {
                job_id: job.id.clone(),
                error: "fatal".to_string(),
                retry_count: 3,
                max_retries: 3,
                task_name: "exhausted_task".to_string(),
                wall_time_ns: 100,
                should_retry: true,
                timed_out: false,
            })
            .unwrap();

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

        scheduler
            .handle_result(JobResult::Failure {
                job_id: job.id.clone(),
                error: "non-retryable".to_string(),
                retry_count: 0,
                max_retries: 3,
                task_name: "no_retry_task".to_string(),
                wall_time_ns: 100,
                should_retry: false,
                timed_out: false,
            })
            .unwrap();

        let dead = scheduler.storage.get_job(&job.id).unwrap().unwrap();
        assert_eq!(dead.status, JobStatus::Dead);
    }

    #[test]
    fn test_handle_cancelled() {
        let scheduler = test_scheduler();
        let job = enqueue_and_run(&scheduler, "cancel_task");

        scheduler
            .handle_result(JobResult::Cancelled {
                job_id: job.id.clone(),
                task_name: "cancel_task".to_string(),
                wall_time_ns: 100,
            })
            .unwrap();

        let cancelled = scheduler.storage.get_job(&job.id).unwrap().unwrap();
        assert_eq!(cancelled.status, JobStatus::Cancelled);
    }

    #[test]
    fn test_try_dispatch_rate_limited() {
        let mut scheduler = test_scheduler();
        scheduler.register_task(
            "rl_task".to_string(),
            TaskConfig {
                retry_policy: RetryPolicy::default(),
                rate_limit: Some(RateLimitConfig {
                    max_tokens: 1.0,
                    refill_rate: 0.0,
                }),
                circuit_breaker: None,
                max_concurrent: None,
            },
        );

        // Enqueue two jobs
        scheduler.storage.enqueue(make_job("rl_task")).unwrap();
        scheduler.storage.enqueue(make_job("rl_task")).unwrap();

        let (tx, mut rx) = make_channel(16);
        let mut counters = TickCounters::default();

        // First tick should dispatch (consumes the one token)
        scheduler.tick(&tx, &mut counters);
        assert!(rx.try_recv().is_ok());

        // Second tick: job dequeued but rate limited, rescheduled
        scheduler.tick(&tx, &mut counters);
        assert!(rx.try_recv().is_err()); // nothing new dispatched

        // The second job should be back in pending with a future scheduled_at
        let jobs = scheduler
            .storage
            .list_jobs(Some(JobStatus::Pending as i32), None, None, 10, 0, None)
            .unwrap();
        assert_eq!(jobs.len(), 1);
        assert!(jobs[0].scheduled_at > now_millis());
    }

    #[test]
    fn test_try_dispatch_circuit_broken() {
        let mut scheduler = test_scheduler();
        let cb_config = crate::resilience::circuit_breaker::CircuitBreakerConfig {
            threshold: 1,
            window_ms: 60_000,
            cooldown_ms: 300_000,
            half_open_max_probes: 5,
            half_open_success_rate: 0.8,
        };
        scheduler.register_task(
            "cb_task".to_string(),
            TaskConfig {
                retry_policy: RetryPolicy::default(),
                rate_limit: None,
                circuit_breaker: Some(cb_config),
                max_concurrent: None,
            },
        );

        // Trip the circuit breaker
        scheduler.circuit_breaker.record_failure("cb_task").unwrap();

        scheduler.storage.enqueue(make_job("cb_task")).unwrap();

        let (tx, mut rx) = make_channel(16);
        let mut counters = TickCounters::default();
        scheduler.tick(&tx, &mut counters);

        // Job should not be dispatched (circuit is open)
        assert!(rx.try_recv().is_err());

        // Job should be rescheduled
        let jobs = scheduler
            .storage
            .list_jobs(Some(JobStatus::Pending as i32), None, None, 10, 0, None)
            .unwrap();
        assert_eq!(jobs.len(), 1);
        assert!(jobs[0].scheduled_at > now_millis());
    }

    #[test]
    fn test_reap_stale_jobs() {
        let mut scheduler = test_scheduler();
        scheduler.register_task(
            "stale_task".to_string(),
            TaskConfig {
                retry_policy: RetryPolicy {
                    max_retries: 3,
                    base_delay_ms: 100,
                    max_delay_ms: 1000,
                    custom_delays_ms: None,
                },
                rate_limit: None,
                circuit_breaker: None,
                max_concurrent: None,
            },
        );

        // Create a job with a very short timeout
        let mut new_job = make_job("stale_task");
        new_job.timeout_ms = 1; // 1ms timeout
        let job = scheduler.storage.enqueue(new_job).unwrap();

        // Dequeue it (sets it to Running with started_at)
        let (tx, _rx) = make_channel(16);
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
            timezone: None,
        };
        scheduler.storage.register_periodic(&row).unwrap();

        scheduler.check_periodic().unwrap();

        // A job should have been enqueued
        let jobs = scheduler
            .storage
            .list_jobs(
                Some(JobStatus::Pending as i32),
                None,
                Some("periodic_task"),
                10,
                0,
                None,
            )
            .unwrap();
        assert_eq!(jobs.len(), 1);
    }

    #[test]
    fn test_auto_cleanup() {
        let storage =
            StorageBackend::Sqlite(crate::storage::sqlite::SqliteStorage::in_memory().unwrap());
        let config = SchedulerConfig {
            result_ttl_ms: Some(1), // 1ms TTL
            ..SchedulerConfig::default()
        };
        let scheduler = Scheduler::new(storage, vec!["default".to_string()], config, None);

        // Enqueue, dequeue, and complete a job
        let job = scheduler.storage.enqueue(make_job("cleanup_task")).unwrap();
        scheduler
            .storage
            .dequeue("default", now_millis() + 1000, None)
            .unwrap();
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
        let storage =
            StorageBackend::Sqlite(crate::storage::sqlite::SqliteStorage::in_memory().unwrap());
        let config = SchedulerConfig {
            reap_interval: 1,
            periodic_check_interval: 1,
            cleanup_interval: 1,
            ..SchedulerConfig::default()
        };
        let scheduler = Scheduler::new(storage, vec!["default".to_string()], config, None);

        scheduler.storage.enqueue(make_job("tick_task")).unwrap();

        let (tx, mut rx) = make_channel(16);
        let mut counters = TickCounters::default();
        scheduler.tick(&tx, &mut counters);

        // Job should be dispatched
        assert!(rx.try_recv().is_ok());
        // Counters should be incremented
        assert_eq!(counters.reap, 1);
        assert_eq!(counters.periodic, 1);
        assert_eq!(counters.cleanup, 1);
    }
}
