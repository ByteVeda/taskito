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
            })?;
        }

        Ok(())
    }

    /// Purge old completed/dead jobs and their errors if result_ttl_ms is set.
    pub(super) fn auto_cleanup(&self) -> Result<()> {
        let ttl = match self.config.result_ttl_ms {
            Some(t) => t,
            None => return Ok(()),
        };

        let cutoff = now_millis().saturating_sub(ttl);

        // Use per-job TTL aware cleanup
        let completed = self.storage.purge_completed_with_ttl(cutoff)?;
        let dead = self.storage.purge_dead(cutoff)?;
        let errors = self.storage.purge_job_errors(cutoff)?;
        let metrics = self.storage.purge_metrics(cutoff).unwrap_or_else(|e| {
            warn!("purge_metrics failed: {e}");
            0
        });
        let logs = self.storage.purge_task_logs(cutoff).unwrap_or_else(|e| {
            warn!("purge_task_logs failed: {e}");
            0
        });

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
                depends_on: vec![],
                expires_at: None,
                result_ttl_ms: None,
                namespace: None,
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

    /// Build a cloudpickle-compatible payload from stored args.
    fn build_periodic_payload(args: &Option<Vec<u8>>) -> Vec<u8> {
        match args {
            Some(blob) => blob.clone(),
            None => Vec::new(),
        }
    }
}
