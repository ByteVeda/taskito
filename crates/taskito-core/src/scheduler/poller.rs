use std::time::Duration;

use log::warn;
use tokio::sync::mpsc::error::TrySendError;

use crate::error::Result;
use crate::job::{now_millis, Job};
use crate::storage::Storage;

use super::Scheduler;

/// Delay before re-scheduling a circuit-broken job (ms).
const CIRCUIT_BREAKER_RETRY_DELAY_MS: i64 = 5000;

/// Delay before re-scheduling a rate-limited job (ms).
const RATE_LIMIT_RETRY_DELAY_MS: i64 = 1000;

/// Delay before re-scheduling a concurrency-limited job (ms).
const CONCURRENCY_RETRY_DELAY_MS: i64 = 500;

/// Delay before re-scheduling a job whose dispatch was rejected because the
/// worker channel was full or closed. Short enough that the worker pool
/// catches up on the next tick rather than waiting for the stale-job reaper.
const CHANNEL_BACKPRESSURE_RETRY_DELAY_MS: i64 = 100;

/// Worker identifier recorded on execution claims taken by the scheduler.
const SCHEDULER_CLAIM_OWNER: &str = "scheduler";

impl Scheduler {
    pub(super) fn try_dispatch(&self, job_tx: &tokio::sync::mpsc::Sender<Job>) -> Result<bool> {
        let now = now_millis();

        let active_queues = self.active_queues();
        if active_queues.is_empty() {
            return Ok(false);
        }

        let job = match self
            .storage
            .dequeue_from(&active_queues, now, self.namespace.as_deref())?
        {
            Some(j) => j,
            None => return Ok(false),
        };

        // Pre-claim soft gates: rate limits and circuit breaker.
        //
        // These don't need to be atomic with the claim — if two schedulers
        // both pass these gates, the gate semantics still hold (each
        // consumes its own token / observes the breaker independently).
        if !self.check_pre_claim_gates(&job, now)? {
            return Ok(false);
        }

        // Claim exactly-once execution. After this point, the job is reserved
        // for this scheduler instance.
        if !self.claim_for_dispatch(&job)? {
            return Ok(false);
        }

        // Post-claim hard gate: concurrency caps must be checked AFTER the
        // claim so two schedulers cannot both pass the cap. Status was
        // already transitioned to `Running` by `dequeue_from`, so the
        // running-count includes this job — use strict `>` to allow exactly
        // `max_concurrent` jobs.
        //
        // If we exceed the cap, roll back: clear the claim row and reset
        // status to `Pending` so the job can be dispatched again later.
        if !self.check_post_claim_concurrency(&job)? {
            self.rollback_claim_and_retry(&job.id, now + CONCURRENCY_RETRY_DELAY_MS)?;
            return Ok(false);
        }

        // Hand the job to the worker pool. If the channel is unavailable we
        // must reverse the claim — otherwise the job sits in `Running` until
        // the stale-reaper times it out, which surfaces as a *timeout* in
        // metrics and middleware (wrong outcome for a job that never ran).
        let job_id = job.id.clone();
        match job_tx.try_send(job) {
            Ok(()) => Ok(true),
            Err(TrySendError::Full(_)) => {
                warn!("worker channel full; rescheduling job {job_id} (worker pool is behind)",);
                self.rollback_claim_and_retry(&job_id, now + CHANNEL_BACKPRESSURE_RETRY_DELAY_MS)?;
                Ok(false)
            }
            Err(TrySendError::Closed(_)) => {
                warn!(
                    "worker channel closed; rescheduling job {job_id} (worker pool shutting down)",
                );
                self.rollback_claim_and_retry(&job_id, now + CHANNEL_BACKPRESSURE_RETRY_DELAY_MS)?;
                Ok(false)
            }
        }
    }

    /// Snapshot the queue list with paused queues filtered out. The paused
    /// list is cached for 1s to avoid hammering storage on every tick. Borrows
    /// the queue list directly in the common case (nothing paused), allocating
    /// only when a filtered copy is actually needed.
    fn active_queues(&self) -> std::borrow::Cow<'_, [String]> {
        let mut cache = self.paused_cache.lock().unwrap_or_else(|poisoned| {
            warn!("paused_cache mutex was poisoned, recovering");
            poisoned.into_inner()
        });
        if cache.1.elapsed() > Duration::from_secs(1) {
            cache.0 = self
                .storage
                .list_paused_queues()
                .unwrap_or_default()
                .into_iter()
                .collect();
            cache.1 = std::time::Instant::now();
        }
        if cache.0.is_empty() {
            std::borrow::Cow::Borrowed(&self.queues)
        } else {
            std::borrow::Cow::Owned(
                self.queues
                    .iter()
                    .filter(|q| !cache.0.contains(*q))
                    .cloned()
                    .collect(),
            )
        }
    }

    /// Apply the pre-claim soft gates (queue rate limit, task circuit
    /// breaker, task rate limit). Returns `Ok(true)` if the job may proceed
    /// to claim, `Ok(false)` if it was rescheduled.
    fn check_pre_claim_gates(&self, job: &Job, now: i64) -> Result<bool> {
        if let Some(qcfg) = self.queue_configs.get(&job.queue) {
            if let Some(ref rl_config) = qcfg.rate_limit {
                let key = format!("queue:{}", job.queue);
                if !self.rate_limiter.try_acquire(&key, rl_config)? {
                    self.storage
                        .retry(&job.id, now + RATE_LIMIT_RETRY_DELAY_MS)?;
                    return Ok(false);
                }
            }
        }

        if let Some(config) = self.task_configs.get(&job.task_name) {
            if config.circuit_breaker.is_some() && !self.circuit_breaker.allow(&job.task_name)? {
                self.storage
                    .retry(&job.id, now + CIRCUIT_BREAKER_RETRY_DELAY_MS)?;
                return Ok(false);
            }

            if let Some(ref rl_config) = config.rate_limit {
                if !self.rate_limiter.try_acquire(&job.task_name, rl_config)? {
                    self.storage
                        .retry(&job.id, now + RATE_LIMIT_RETRY_DELAY_MS)?;
                    return Ok(false);
                }
            }
        }

        Ok(true)
    }

    /// Try to claim exactly-once execution. Returns `Ok(true)` if the claim
    /// was taken (or recoverably failed and the caller should still attempt
    /// dispatch), `Ok(false)` if the job was already claimed by another
    /// scheduler.
    fn claim_for_dispatch(&self, job: &Job) -> Result<bool> {
        match self.storage.claim_execution(&job.id, SCHEDULER_CLAIM_OWNER) {
            Ok(true) => Ok(true),
            Ok(false) => Ok(false),
            Err(e) => {
                // Don't drop the job on a transient claim error — proceed and
                // let the worker handle the duplicate execution defensively.
                warn!("claim_execution error for job {}: {e}", job.id);
                Ok(true)
            }
        }
    }

    /// Apply the post-claim hard gates (per-queue and per-task concurrency
    /// caps). Returns `Ok(true)` if the job may proceed to dispatch,
    /// `Ok(false)` if the cap is exceeded — caller is responsible for
    /// rolling back the claim.
    fn check_post_claim_concurrency(&self, job: &Job) -> Result<bool> {
        if let Some(qcfg) = self.queue_configs.get(&job.queue) {
            if let Some(max_conc) = qcfg.max_concurrent {
                let stats = self.storage.stats_by_queue(&job.queue)?;
                if stats.running > max_conc as i64 {
                    return Ok(false);
                }
            }
        }

        if let Some(config) = self.task_configs.get(&job.task_name) {
            if let Some(max_conc) = config.max_concurrent {
                let running = self.storage.count_running_by_task(&job.task_name)?;
                if running > max_conc as i64 {
                    return Ok(false);
                }
            }
        }

        Ok(true)
    }

    /// Reverse a successful `claim_execution` and reschedule the job. Used
    /// when a post-claim gate rejects the job after the claim row has
    /// already been written.
    fn rollback_claim_and_retry(&self, job_id: &str, next_at: i64) -> Result<()> {
        if let Err(e) = self.storage.complete_execution(job_id) {
            warn!("failed to clear execution claim during rollback for job {job_id}: {e}");
        }
        self.storage.retry(job_id, next_at)
    }
}
