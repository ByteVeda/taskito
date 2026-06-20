mod maintenance;
mod poller;
mod result_handler;
#[cfg(feature = "push-dispatch")]
pub mod wake;

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
    /// Maximum number of jobs claimed per dispatch round. `1` (the default)
    /// preserves the original one-job-per-round-trip behavior; values above
    /// `1` enable batch claiming for higher throughput.
    pub batch_size: usize,
    /// Minimum age (ms) before a DLQ entry is auto-retried. `None` disables.
    pub dlq_auto_retry_delay_ms: Option<i64>,
    /// Max DLQ auto-retries per entry before giving up.
    pub dlq_auto_retry_max: i32,
    /// Check DLQ auto-retry every N ticks.
    pub dlq_auto_retry_interval: u32,
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
            batch_size: 1,
            dlq_auto_retry_delay_ms: None,
            dlq_auto_retry_max: 1,
            dlq_auto_retry_interval: 60,
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

/// Outcome of processing a job result, returned to the caller (the binding)
/// for its middleware hook dispatch.
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
    /// Wake source for push-dispatch, installed before `run()`. Taken (moved
    /// out) once when the loop starts. `None` means the loop polls as today.
    #[cfg(feature = "push-dispatch")]
    wake_source: Mutex<Option<wake::WakeSource>>,
    /// Earliest `scheduled_at` of any delayed job seen at enqueue time, so the
    /// push loop can arm a timer for the next delayed job rather than waking
    /// immediately. Milliseconds; `i64::MAX` means "nothing scheduled".
    #[cfg(feature = "push-dispatch")]
    next_scheduled_at: std::sync::atomic::AtomicI64,
}

/// Counters for tick-based scheduling of periodic maintenance tasks.
#[derive(Default)]
struct TickCounters {
    reap: u32,
    periodic: u32,
    cleanup: u32,
    dlq_auto_retry: u32,
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
            #[cfg(feature = "push-dispatch")]
            wake_source: Mutex::new(None),
            #[cfg(feature = "push-dispatch")]
            next_scheduled_at: std::sync::atomic::AtomicI64::new(i64::MAX),
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
        // Push-dispatch: if a wake source was configured, run the event-driven
        // loop. Otherwise (and always when the feature is off) fall through to
        // the unchanged adaptive-poll loop below.
        #[cfg(feature = "push-dispatch")]
        if let Some(wake) = self.take_wake_source() {
            self.run_push(job_tx, wake).await;
            return;
        }

        let mut counters = TickCounters::default();
        let base_interval = self.config.poll_interval;
        let max_interval = Duration::from_millis(200);
        let mut current_interval = base_interval;

        loop {
            tokio::select! {
                _ = self.shutdown.notified() => break,
                _ = tokio::time::sleep(current_interval) => {}
            }

            let had_work = self.tick(&job_tx, &mut counters);
            if had_work {
                current_interval = base_interval;
            } else {
                current_interval = (current_interval * 2).min(max_interval);
            }
        }
    }

    /// Execute one iteration of the scheduler loop.
    /// Returns true if any work was done (job dispatched or periodic task enqueued),
    /// which resets the adaptive poll interval.
    fn tick(&self, job_tx: &tokio::sync::mpsc::Sender<Job>, counters: &mut TickCounters) -> bool {
        let dispatched = self.tick_dispatch(job_tx);
        let had_maintenance = self.tick_maintenance(counters);
        dispatched || had_maintenance
    }

    /// Run one dispatch round (batch or single). Returns true if a job was
    /// dispatched. Pulled out of [`Scheduler::tick`] so the push loop can run
    /// dispatch independently of the maintenance cadence.
    fn tick_dispatch(&self, job_tx: &tokio::sync::mpsc::Sender<Job>) -> bool {
        let dispatch_result = if self.config.batch_size > 1 {
            self.try_dispatch_batch(job_tx)
        } else {
            self.try_dispatch(job_tx)
        };
        match dispatch_result {
            Ok(d) => d,
            Err(e) => {
                error!("scheduler error: {e}");
                false
            }
        }
    }

    /// Advance the tick counters and run any due maintenance (reap, periodic
    /// enqueue, cleanup). Returns true if periodic enqueue ran (work that
    /// should reset the poll backoff).
    fn tick_maintenance(&self, counters: &mut TickCounters) -> bool {
        let mut had_maintenance = false;

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
            match self.check_periodic() {
                Ok(()) => {
                    // Periodic tasks may have been enqueued — reset polling
                    // so the next tick picks them up quickly.
                    had_maintenance = true;
                }
                Err(e) => error!("periodic check error: {e}"),
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

        counters.dlq_auto_retry += 1;
        if counters
            .dlq_auto_retry
            .is_multiple_of(self.config.dlq_auto_retry_interval)
        {
            if let Err(e) = self.auto_retry_dlq() {
                error!("dlq auto-retry error: {e}");
            }
        }

        had_maintenance
    }
}

#[cfg(feature = "push-dispatch")]
impl Scheduler {
    /// Fallback dispatch interval when push-dispatch is on. A missed wake can
    /// never strand a job longer than this.
    const PUSH_FALLBACK_INTERVAL: Duration = Duration::from_secs(2);

    /// Cadence of the dedicated maintenance ticker, decoupled from dispatch.
    const PUSH_MAINTENANCE_INTERVAL: Duration = Duration::from_millis(500);

    /// Install the wake source the push loop should consume. Call before
    /// `run()`. With no wake source installed, `run()` keeps polling.
    pub fn set_wake_source(&self, source: wake::WakeSource) {
        let mut guard = self.wake_source.lock().unwrap_or_else(|p| p.into_inner());
        *guard = Some(source);
    }

    /// Move the installed wake source out for the run loop. Returns `None` if
    /// none was installed (the loop then polls).
    fn take_wake_source(&self) -> Option<wake::WakeSource> {
        self.wake_source
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .take()
    }

    /// Bridge a (re)scheduled job into the push loop: wake immediately if it
    /// is ready now, otherwise arm the delayed timer. Used by the retry and
    /// periodic-enqueue paths, which run on the scheduler and already hold a
    /// storage handle.
    pub(crate) fn signal_scheduled(&self, scheduled_at: i64) {
        use crate::storage::notify::StorageNotifier;
        if scheduled_at <= crate::job::now_millis() {
            match &self.storage {
                StorageBackend::Sqlite(s) => s.notify_job_ready("", scheduled_at),
                #[cfg(feature = "postgres")]
                StorageBackend::Postgres(s) => s.notify_job_ready("", scheduled_at),
                #[cfg(feature = "redis")]
                StorageBackend::Redis(s) => s.notify_job_ready("", scheduled_at),
            }
        } else {
            self.note_scheduled_at(scheduled_at);
        }
    }

    /// Record the earliest delayed-job schedule so the loop can arm a timer.
    /// Ready jobs (`scheduled_at <= now`) wake immediately and don't update
    /// this. Safe to call from any thread.
    pub fn note_scheduled_at(&self, scheduled_at: i64) {
        use std::sync::atomic::Ordering;
        let mut current = self.next_scheduled_at.load(Ordering::Relaxed);
        while scheduled_at < current {
            match self.next_scheduled_at.compare_exchange_weak(
                current,
                scheduled_at,
                Ordering::Relaxed,
                Ordering::Relaxed,
            ) {
                Ok(_) => break,
                Err(observed) => current = observed,
            }
        }
    }

    /// Duration until the next delayed job is due, capped at the fallback
    /// interval. Resets the tracker once the time has passed so a stale value
    /// can't pin the timer low forever.
    fn next_delayed_timer(&self) -> Duration {
        use std::sync::atomic::Ordering;
        let next = self.next_scheduled_at.load(Ordering::Relaxed);
        if next == i64::MAX {
            return Self::PUSH_FALLBACK_INTERVAL;
        }
        let now = crate::job::now_millis();
        if next <= now {
            // The delayed job is due; clear the tracker and dispatch now.
            self.next_scheduled_at.store(i64::MAX, Ordering::Relaxed);
            return Duration::ZERO;
        }
        Duration::from_millis((next - now) as u64).min(Self::PUSH_FALLBACK_INTERVAL)
    }

    /// Event-driven dispatch loop. Dispatches on a wake signal, on the
    /// fallback timer, or when a delayed job comes due. Maintenance runs on
    /// its own ticker so its cadence is independent of dispatch.
    async fn run_push(&self, job_tx: tokio::sync::mpsc::Sender<Job>, mut wake: wake::WakeSource) {
        let mut counters = TickCounters::default();
        let mut maintenance = tokio::time::interval(Self::PUSH_MAINTENANCE_INTERVAL);
        maintenance.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        loop {
            let fallback = self.next_delayed_timer();
            tokio::select! {
                _ = self.shutdown.notified() => break,
                _ = wake.wait() => {
                    // Drain dispatch fully so a single wake clears the queue.
                    while self.tick_dispatch(&job_tx) {}
                }
                _ = tokio::time::sleep(fallback) => {
                    while self.tick_dispatch(&job_tx) {}
                }
                _ = maintenance.tick() => {
                    if self.tick_maintenance(&mut counters) {
                        // Periodic enqueue may have produced ready work.
                        while self.tick_dispatch(&job_tx) {}
                    }
                }
            }
        }
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
            notes: None,
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
    fn test_explicit_zero_max_retries_no_retry() {
        // The task policy would retry 3×, but an explicit per-job max_retries=0
        // (at-most-once) must override it and go straight to the DLQ.
        let mut scheduler = test_scheduler();
        scheduler.register_task(
            "noretry_task".to_string(),
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

        let job = enqueue_and_run(&scheduler, "noretry_task");

        let outcome = scheduler
            .handle_result(JobResult::Failure {
                job_id: job.id.clone(),
                error: "boom".to_string(),
                retry_count: 0,
                max_retries: 0,
                task_name: "noretry_task".to_string(),
                wall_time_ns: 500_000,
                should_retry: true,
                timed_out: false,
            })
            .unwrap();

        assert!(matches!(outcome, ResultOutcome::DeadLettered { .. }));
        let dead = scheduler.storage.list_dead(10, 0).unwrap();
        assert!(dead.iter().any(|d| d.original_job_id == job.id));
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
    fn test_try_dispatch_per_task_concurrency_allows_exactly_max() {
        // Regression: with `max_concurrent = 2` we expect exactly 2 jobs to
        // be dispatched, not `max - 1`. The `dequeue_from` step transitions
        // status to `Running` before the cap check, so the count includes
        // the just-dequeued job — the gate must use `>` rather than `>=`.
        let mut scheduler = test_scheduler();
        scheduler.register_task(
            "conc_task".to_string(),
            TaskConfig {
                retry_policy: RetryPolicy::default(),
                rate_limit: None,
                circuit_breaker: None,
                max_concurrent: Some(2),
            },
        );

        for _ in 0..3 {
            scheduler.storage.enqueue(make_job("conc_task")).unwrap();
        }

        let (tx, mut rx) = make_channel(16);
        let mut counters = TickCounters::default();

        scheduler.tick(&tx, &mut counters);
        scheduler.tick(&tx, &mut counters);
        scheduler.tick(&tx, &mut counters);

        let mut dispatched = 0;
        while rx.try_recv().is_ok() {
            dispatched += 1;
        }
        assert_eq!(
            dispatched, 2,
            "expected exactly max_concurrent jobs dispatched"
        );

        // The rejected job should be back to Pending with a future schedule
        // and its execution-claim row cleared.
        let pending = scheduler
            .storage
            .list_jobs(Some(JobStatus::Pending as i32), None, None, 10, 0, None)
            .unwrap();
        assert_eq!(pending.len(), 1);
        assert!(pending[0].scheduled_at > now_millis());

        let claims = scheduler
            .storage
            .list_claims_by_worker("scheduler")
            .unwrap();
        assert_eq!(
            claims.len(),
            2,
            "rejected job's claim row should have been rolled back"
        );
        assert!(
            !claims.contains(&pending[0].id),
            "rejected job should not have a stale execution claim"
        );
    }

    #[test]
    fn test_try_dispatch_per_task_max_one_dispatches_one() {
        // Regression: `max_concurrent = 1` must allow exactly one job to
        // run. With the pre-fix `>=` check the running-count (which already
        // includes the just-dequeued job) tripped the gate and the job was
        // rescheduled — effectively `max_concurrent = 0`.
        let mut scheduler = test_scheduler();
        scheduler.register_task(
            "single_task".to_string(),
            TaskConfig {
                retry_policy: RetryPolicy::default(),
                rate_limit: None,
                circuit_breaker: None,
                max_concurrent: Some(1),
            },
        );

        scheduler.storage.enqueue(make_job("single_task")).unwrap();

        let (tx, mut rx) = make_channel(16);
        let mut counters = TickCounters::default();
        scheduler.tick(&tx, &mut counters);

        assert!(
            rx.try_recv().is_ok(),
            "the single allowed concurrent job must dispatch"
        );
    }

    #[test]
    fn test_try_dispatch_per_queue_concurrency_allows_exactly_max() {
        // Same regression for the queue-level cap.
        let mut scheduler = test_scheduler();
        scheduler.register_queue_config(
            "default".to_string(),
            QueueConfig {
                rate_limit: None,
                max_concurrent: Some(2),
            },
        );

        for _ in 0..3 {
            scheduler.storage.enqueue(make_job("queue_capped")).unwrap();
        }

        let (tx, mut rx) = make_channel(16);
        let mut counters = TickCounters::default();
        scheduler.tick(&tx, &mut counters);
        scheduler.tick(&tx, &mut counters);
        scheduler.tick(&tx, &mut counters);

        let mut dispatched = 0;
        while rx.try_recv().is_ok() {
            dispatched += 1;
        }
        assert_eq!(dispatched, 2);

        let pending = scheduler
            .storage
            .list_jobs(Some(JobStatus::Pending as i32), None, None, 10, 0, None)
            .unwrap();
        assert_eq!(pending.len(), 1);
    }

    #[test]
    fn test_try_dispatch_reschedules_on_closed_channel() {
        // Regression: when the worker channel is closed (worker pool
        // shutting down) the job has already been claimed in storage —
        // dropping it without rolling back leaves it in `Running` until
        // the stale-reaper times it out, which surfaces as a *timeout*
        // in metrics. The poller must clear the claim and reset the job
        // to `Pending` so the next dispatch attempt picks it up cleanly.
        let scheduler = test_scheduler();
        let job = scheduler
            .storage
            .enqueue(make_job("ch_closed_task"))
            .unwrap();

        let (tx, rx) = make_channel(16);
        drop(rx);

        let mut counters = TickCounters::default();
        scheduler.tick(&tx, &mut counters);

        let after = scheduler.storage.get_job(&job.id).unwrap().unwrap();
        assert_eq!(
            after.status,
            JobStatus::Pending,
            "job must be returned to Pending when dispatch fails"
        );
        assert!(after.scheduled_at > now_millis());

        let claims = scheduler
            .storage
            .list_claims_by_worker("scheduler")
            .unwrap();
        assert!(
            !claims.contains(&job.id),
            "execution claim must be cleared on dispatch failure"
        );
    }

    #[test]
    fn test_try_dispatch_reschedules_on_full_channel() {
        // Same regression when the channel is *full* rather than closed —
        // the worker pool is behind but still alive. The job must come back
        // to Pending so the next tick has a chance to dispatch it once the
        // pool drains.
        let scheduler = test_scheduler();
        let job = scheduler.storage.enqueue(make_job("ch_full_task")).unwrap();

        // Capacity-1 channel pre-filled with a sentinel job. The poller's
        // `try_send` will see `TrySendError::Full`.
        let (tx, _rx) = make_channel(1);
        let sentinel = scheduler.storage.enqueue(make_job("sentinel")).unwrap();
        tx.try_send(sentinel).expect("pre-fill should succeed");

        let mut counters = TickCounters::default();
        scheduler.tick(&tx, &mut counters);

        let after = scheduler.storage.get_job(&job.id).unwrap().unwrap();
        assert_eq!(after.status, JobStatus::Pending);
        assert!(after.scheduled_at > now_millis());

        let claims = scheduler
            .storage
            .list_claims_by_worker("scheduler")
            .unwrap();
        assert!(!claims.contains(&job.id));
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
    fn test_auto_cleanup_per_entry_ttl_without_global() {
        // With no queue-wide result_ttl, a per-job result_ttl must still be
        // honored (the per-entry purge runs every tick).
        let storage =
            StorageBackend::Sqlite(crate::storage::sqlite::SqliteStorage::in_memory().unwrap());
        let config = SchedulerConfig {
            result_ttl_ms: None,
            ..SchedulerConfig::default()
        };
        let scheduler = Scheduler::new(storage, vec!["default".to_string()], config, None);

        let mut nj = make_job("per_entry_ttl");
        nj.result_ttl_ms = Some(1); // 1ms per-job TTL
        let job = scheduler.storage.enqueue(nj).unwrap();
        scheduler
            .storage
            .dequeue("default", now_millis() + 1000, None)
            .unwrap();
        scheduler.storage.complete(&job.id, Some(vec![1])).unwrap();

        std::thread::sleep(Duration::from_millis(10));
        scheduler.auto_cleanup().unwrap();

        assert!(
            scheduler.storage.get_job(&job.id).unwrap().is_none(),
            "per-job result_ttl must be purged even without a global result_ttl"
        );
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

#[cfg(all(test, feature = "push-dispatch"))]
mod push_tests {
    use super::*;
    use crate::job::{now_millis, NewJob};
    use crate::storage::Storage;
    use std::time::Duration;

    fn push_scheduler() -> Scheduler {
        let storage =
            StorageBackend::Sqlite(crate::storage::sqlite::SqliteStorage::in_memory().unwrap());
        Scheduler::new(
            storage,
            vec!["default".to_string()],
            SchedulerConfig::default(),
            None,
        )
    }

    fn ready_job(task_name: &str) -> NewJob {
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
            notes: None,
            depends_on: vec![],
            expires_at: None,
            result_ttl_ms: None,
            namespace: None,
        }
    }

    /// Enqueuing a ready job must wake the in-process Notify within 50ms.
    #[test]
    fn test_wake_fires_on_immediate_enqueue() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let scheduler = push_scheduler();
            let notify = match scheduler.storage() {
                StorageBackend::Sqlite(s) => s.notify_handle().clone(),
                _ => unreachable!("test uses sqlite"),
            };

            // Enqueue goes through the StorageBackend chokepoint, which calls
            // notify_one() for ready jobs.
            scheduler.storage().enqueue(ready_job("wake_task")).unwrap();

            // notify_one() before notified() still wakes the next waiter, so a
            // brief wait must resolve.
            let woke = tokio::time::timeout(Duration::from_millis(50), notify.notified()).await;
            assert!(
                woke.is_ok(),
                "enqueue of a ready job must wake the scheduler"
            );
        });
    }

    /// A delayed job must NOT wake immediately — the Notify stays unsignaled.
    #[test]
    fn test_delayed_job_does_not_wake() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let scheduler = push_scheduler();
            let notify = match scheduler.storage() {
                StorageBackend::Sqlite(s) => s.notify_handle().clone(),
                _ => unreachable!("test uses sqlite"),
            };

            let mut delayed = ready_job("later_task");
            delayed.scheduled_at = now_millis() + 60_000; // 1 minute out
            scheduler.storage().enqueue(delayed).unwrap();

            let woke = tokio::time::timeout(Duration::from_millis(50), notify.notified()).await;
            assert!(woke.is_err(), "a delayed job must not wake immediately");

            // It should instead arm the delayed timer.
            let timer = scheduler.next_delayed_timer();
            assert!(timer > Duration::ZERO && timer <= Scheduler::PUSH_FALLBACK_INTERVAL);
        });
    }

    /// With no wake delivered, the fallback timer still dispatches a job.
    #[test]
    fn test_fallback_poll_dispatches_without_wake() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let scheduler = push_scheduler();

            // Insert a ready job directly via the inherent SQLite method so the
            // StorageBackend notify chokepoint is bypassed — simulating a
            // missed wake. The fallback dispatch path must still pick it up.
            match scheduler.storage() {
                StorageBackend::Sqlite(s) => {
                    s.enqueue(ready_job("fallback_task")).unwrap();
                }
                _ => unreachable!("test uses sqlite"),
            }

            let (tx, mut rx) = tokio::sync::mpsc::channel(16);
            // Drive a single fallback dispatch round directly.
            while scheduler.tick_dispatch(&tx) {}

            assert!(
                rx.try_recv().is_ok(),
                "fallback dispatch must claim the job even without a wake"
            );

            let job = rx.try_recv();
            // Only one job existed.
            assert!(job.is_err());
        });
    }

    /// `note_scheduled_at` keeps the earliest schedule and clears once due.
    #[test]
    fn test_next_delayed_timer_tracks_earliest() {
        let scheduler = push_scheduler();
        let now = now_millis();
        scheduler.note_scheduled_at(now + 10_000);
        scheduler.note_scheduled_at(now + 5_000);
        scheduler.note_scheduled_at(now + 20_000);

        let timer = scheduler.next_delayed_timer();
        // Earliest (5s out), capped at the fallback interval (2s).
        assert!(timer <= Scheduler::PUSH_FALLBACK_INTERVAL);
        assert!(timer > Duration::ZERO);
    }
}
