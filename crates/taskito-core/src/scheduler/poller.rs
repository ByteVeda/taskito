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

        self.gate_and_dispatch(job, now, job_tx)
    }

    /// Batch variant of [`try_dispatch`]. Claims up to `batch_size` jobs in a
    /// single round-trip, then runs the exact same per-job gate/claim/
    /// concurrency/dispatch logic the single path uses. The pre-sized batch is
    /// advisory only — the hard per-task and per-queue caps are still enforced
    /// per job after the claim, rolling back any job that exceeds a limit.
    pub(super) fn try_dispatch_batch(
        &self,
        job_tx: &tokio::sync::mpsc::Sender<Job>,
    ) -> Result<bool> {
        let now = now_millis();

        let active_queues = self.active_queues();
        if active_queues.is_empty() {
            return Ok(false);
        }

        // Size the batch to the worker pool's free capacity so we never claim
        // more jobs than the channel can immediately accept. `try_send` still
        // guards each hand-off, but pre-sizing avoids needless claim/rollback
        // churn. Always claim at least one.
        let budget = self.config.batch_size.min(job_tx.capacity().max(1));

        let jobs = self.storage.dequeue_batch_from(
            &active_queues,
            now,
            self.namespace.as_deref(),
            budget,
        )?;
        if jobs.is_empty() {
            return Ok(false);
        }

        // Every job in `jobs` is already claimed (Running). Isolate per-job
        // failures so one error doesn't strand the rest of the batch in
        // Running until the reaper times them out.
        let mut dispatched_any = false;
        for job in jobs {
            match self.gate_and_dispatch(job, now, job_tx) {
                Ok(true) => dispatched_any = true,
                Ok(false) => {}
                Err(e) => log::warn!("batch dispatch failed for a claimed job: {e}"),
            }
        }
        Ok(dispatched_any)
    }

    /// Run the post-dequeue pipeline for a single already-claimed (Running)
    /// job: soft pre-claim gates, exactly-once claim, hard concurrency caps,
    /// and hand-off to the worker pool. Returns `Ok(true)` if the job was
    /// dispatched, `Ok(false)` if it was gated/rolled back. Shared by both the
    /// single and batch dispatch paths so limit enforcement never drifts.
    fn gate_and_dispatch(
        &self,
        job: Job,
        now: i64,
        job_tx: &tokio::sync::mpsc::Sender<Job>,
    ) -> Result<bool> {
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
        // already transitioned to `Running` by the dequeue, so the
        // running-count includes this job — use strict `>` to allow exactly
        // `max_concurrent` jobs.
        //
        // If we exceed the cap, roll back: clear the claim row and reset
        // status to `Pending` so the job can be dispatched again later.
        if !self.check_post_claim_concurrency(&job)? {
            self.rollback_claim_and_reschedule(&job.id, now + CONCURRENCY_RETRY_DELAY_MS)?;
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
                self.rollback_claim_and_reschedule(
                    &job_id,
                    now + CHANNEL_BACKPRESSURE_RETRY_DELAY_MS,
                )?;
                Ok(false)
            }
            Err(TrySendError::Closed(_)) => {
                warn!(
                    "worker channel closed; rescheduling job {job_id} (worker pool shutting down)",
                );
                self.rollback_claim_and_reschedule(
                    &job_id,
                    now + CHANNEL_BACKPRESSURE_RETRY_DELAY_MS,
                )?;
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
                        .reschedule(&job.id, now + RATE_LIMIT_RETRY_DELAY_MS)?;
                    return Ok(false);
                }
            }
        }

        if let Some(config) = self.task_configs.get(&job.task_name) {
            if config.circuit_breaker.is_some() && !self.circuit_breaker.allow(&job.task_name)? {
                self.storage
                    .reschedule(&job.id, now + CIRCUIT_BREAKER_RETRY_DELAY_MS)?;
                return Ok(false);
            }

            if let Some(ref rl_config) = config.rate_limit {
                if !self.rate_limiter.try_acquire(&job.task_name, rl_config)? {
                    self.storage
                        .reschedule(&job.id, now + RATE_LIMIT_RETRY_DELAY_MS)?;
                    return Ok(false);
                }
            }
        }

        Ok(true)
    }

    /// Try to claim exactly-once execution. Returns `Ok(true)` only if the
    /// claim was actually taken; `Ok(false)` if it was already claimed by
    /// another scheduler **or** the claim attempt errored.
    fn claim_for_dispatch(&self, job: &Job) -> Result<bool> {
        match self.storage.claim_execution(&job.id, SCHEDULER_CLAIM_OWNER) {
            Ok(true) => Ok(true),
            Ok(false) => Ok(false),
            Err(e) => {
                // Treat a claim error as "not claimed" and skip this tick. The
                // job stays Running and the stale-reaper will requeue it. The
                // previous behaviour (dispatch anyway) caused duplicate
                // execution when several schedulers hit a transient storage
                // error at once, since no claim row actually guarded the job.
                warn!("claim_execution error for job {}; skipping: {e}", job.id);
                Ok(false)
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
    /// already been written. Uses `reschedule` (not `retry`) so a job that
    /// never executed does not lose retry budget.
    fn rollback_claim_and_reschedule(&self, job_id: &str, next_at: i64) -> Result<()> {
        if let Err(e) = self.storage.complete_execution(job_id) {
            warn!("failed to clear execution claim during rollback for job {job_id}: {e}");
        }
        self.storage.reschedule(job_id, next_at)
    }
}
