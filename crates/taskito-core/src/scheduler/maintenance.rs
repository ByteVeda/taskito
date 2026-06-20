use log::{error, info, warn};

use crate::error::Result;
use crate::job::{now_millis, NewJob};
use crate::periodic::{next_cron_time, next_cron_time_tz};
use crate::storage::Storage;

use super::{JobResult, Scheduler};

/// Default max retries for periodic tasks.
const PERIODIC_DEFAULT_MAX_RETRIES: i32 = 3;

/// Default timeout for periodic tasks (ms).
const PERIODIC_DEFAULT_TIMEOUT_MS: i64 = 300_000;

impl Scheduler {
    pub(super) fn reap_stale(&self) -> Result<()> {
        let now = now_millis();
        // Expire pending jobs that passed their TTL
        if let Err(e) = self.storage.expire_pending_jobs(now) {
            warn!("expire_pending_jobs error: {e}");
        }
        // Reap expired distributed locks
        if let Err(e) = self.storage.reap_expired_locks(now) {
            warn!("reap_expired_locks error: {e}");
        }
        // Purge stale execution claims (older than 1 hour)
        let claim_cutoff = now.saturating_sub(3_600_000);
        if let Err(e) = self.storage.purge_execution_claims(claim_cutoff) {
            warn!("purge_execution_claims error: {e}");
        }
        let stale_jobs = self.storage.reap_stale_jobs(now)?;

        for job in stale_jobs {
            let error = format!("job timed out after {}ms", job.timeout_ms);
            let _ = self.handle_result(JobResult::Failure {
                job_id: job.id.clone(),
                error,
                retry_count: job.retry_count,
                max_retries: job.max_retries,
                task_name: job.task_name.clone(),
                wall_time_ns: 0,
                should_retry: true,
                timed_out: true,
            })?;
        }

        Ok(())
    }

    /// Purge expired completed/dead jobs and their side data. The per-entry TTL
    /// purges run every tick — a job or DLQ entry can carry its own `result_ttl`
    /// even when no queue-wide `result_ttl` is configured. The global-cutoff
    /// deletes (and the side tables, which have no per-entry TTL) only run when a
    /// global `result_ttl` is set.
    pub(super) fn auto_cleanup(&self) -> Result<()> {
        let now = now_millis();
        let global_cutoff = self.config.result_ttl_ms.map(|ttl| now.saturating_sub(ttl));
        // `i64::MIN` disables the methods' global-cutoff branch (`failed_at < MIN`
        // never matches), leaving only the per-entry TTL deletes.
        let ttl_cutoff = global_cutoff.unwrap_or(i64::MIN);

        let completed = self.storage.purge_completed_with_ttl(ttl_cutoff)?;
        let dead = self.storage.purge_dead_with_ttl(ttl_cutoff)?;

        let (errors, metrics, logs) = match global_cutoff {
            Some(cutoff) => {
                let errors = self.storage.purge_job_errors(cutoff)?;
                let metrics = self.storage.purge_metrics(cutoff).unwrap_or_else(|e| {
                    warn!("purge_metrics failed: {e}");
                    0
                });
                let logs = self.storage.purge_task_logs(cutoff).unwrap_or_else(|e| {
                    warn!("purge_task_logs failed: {e}");
                    0
                });
                (errors, metrics, logs)
            }
            None => (0, 0, 0),
        };

        if completed + dead + errors + metrics + logs > 0 {
            info!(
                "auto-cleanup: purged {completed} completed, {dead} dead, {errors} errors, {metrics} metrics, {logs} logs"
            );
        }

        Ok(())
    }

    /// Check for periodic tasks that are due and enqueue them.
    pub(super) fn check_periodic(&self) -> Result<()> {
        let now = now_millis();
        let due_tasks = self.storage.get_due_periodic(now)?;

        for task in due_tasks {
            let unique_key = Some(format!("periodic:{}:{}", task.name, now));
            let new_job = NewJob {
                queue: task.queue.clone(),
                task_name: task.task_name.clone(),
                payload: Self::build_periodic_payload(&task.args),
                priority: 0,
                scheduled_at: now,
                max_retries: PERIODIC_DEFAULT_MAX_RETRIES,
                timeout_ms: PERIODIC_DEFAULT_TIMEOUT_MS,
                unique_key,
                metadata: None,
                notes: None,
                depends_on: vec![],
                expires_at: None,
                result_ttl_ms: None,
                namespace: self.namespace.clone(),
            };

            if let Err(e) = self.storage.enqueue_unique(new_job) {
                error!("failed to enqueue periodic task '{}': {e}", task.name);
                continue;
            }

            let next_run = match if let Some(ref tz) = task.timezone {
                next_cron_time_tz(&task.cron_expr, now, tz)
            } else {
                next_cron_time(&task.cron_expr, now)
            } {
                Ok(t) => t,
                Err(e) => {
                    error!("failed to compute next run for '{}': {e}", task.name);
                    continue;
                }
            };

            if let Err(e) = self
                .storage
                .update_periodic_schedule(&task.name, now, next_run)
            {
                error!("failed to update schedule for '{}': {e}", task.name);
            }
        }

        Ok(())
    }

    /// Auto-retry eligible DLQ entries that have aged past the configured delay.
    pub(super) fn auto_retry_dlq(&self) -> Result<()> {
        let delay = match self.config.dlq_auto_retry_delay_ms {
            Some(d) => d,
            None => return Ok(()),
        };

        let now = now_millis();
        let cutoff = now.saturating_sub(delay);
        let max_retries = self.config.dlq_auto_retry_max;

        // Only retry entries this worker actually serves (its namespace + active,
        // non-paused queues), mirroring the poller's dequeue scoping.
        let active_queues = self.active_queues();
        let candidates = self.storage.list_dead_for_retry(
            cutoff,
            max_retries,
            self.namespace.as_deref(),
            &active_queues,
            50,
        )?;

        if candidates.is_empty() {
            return Ok(());
        }

        let mut retried = 0u64;
        for entry in &candidates {
            match self.storage.retry_dead(&entry.id) {
                Ok(new_id) => {
                    info!(
                        "dlq auto-retry: {} -> {} (attempt {}/{})",
                        entry.id,
                        new_id,
                        entry.dlq_retry_count + 1,
                        max_retries
                    );
                    retried += 1;
                }
                Err(e) => {
                    warn!("dlq auto-retry failed for {}: {e}", entry.id);
                }
            }
        }

        if retried > 0 {
            info!("dlq auto-retry: retried {retried} entries");
        }

        Ok(())
    }

    /// Build a payload from stored args. Opaque to the core — the binding
    /// (de)serializes it with whatever serializer it chose at enqueue.
    fn build_periodic_payload(args: &Option<Vec<u8>>) -> Vec<u8> {
        match args {
            Some(blob) => blob.clone(),
            None => Vec::new(),
        }
    }
}
