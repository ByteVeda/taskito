use log::{error, warn};

use crate::error::Result;
use crate::storage::Storage;

use super::{JobResult, ResultOutcome, Scheduler};

impl Scheduler {
    /// Handle a completed or failed job result from a worker.
    ///
    /// Returns a [`ResultOutcome`] describing the action taken, so the
    /// caller can dispatch Python-side middleware hooks and events.
    pub fn handle_result(&self, result: JobResult) -> Result<ResultOutcome> {
        match result {
            JobResult::Success {
                job_id,
                result,
                ref task_name,
                wall_time_ns,
            } => {
                self.storage.complete(&job_id, result)?;

                // Clear execution claim
                if let Err(e) = self.storage.complete_execution(&job_id) {
                    error!("failed to clear execution claim for job {job_id}: {e}");
                }

                if let Err(e) =
                    self.storage
                        .record_metric(task_name, &job_id, wall_time_ns, 0, true)
                {
                    error!("failed to record metric for job {job_id}: {e}");
                }

                if let Err(e) = self.circuit_breaker.record_success(task_name) {
                    error!("circuit breaker error for {task_name}: {e}");
                }

                Ok(ResultOutcome::Success {
                    job_id,
                    task_name: task_name.clone(),
                })
            }
            JobResult::Failure {
                job_id,
                error,
                retry_count,
                max_retries,
                task_name,
                wall_time_ns,
                should_retry,
                timed_out,
            } => {
                // Clear execution claim so it can be retried
                if let Err(e) = self.storage.complete_execution(&job_id) {
                    log::error!("failed to clear execution claim for job {job_id}: {e}");
                }

                if let Err(e) = self.storage.record_error(&job_id, retry_count, &error) {
                    log::error!("failed to record error for job {job_id}: {e}");
                }

                if let Err(e) =
                    self.storage
                        .record_metric(&task_name, &job_id, wall_time_ns, 0, false)
                {
                    log::error!("failed to record metric for job {job_id}: {e}");
                }

                if let Err(e) = self.circuit_breaker.record_failure(&task_name) {
                    log::error!("circuit breaker error for {task_name}: {e}");
                }

                // If should_retry is false (exception filtering), skip straight to DLQ
                if !should_retry {
                    match self.storage.get_job(&job_id)? {
                        Some(job) => self.dlq.move_to_dlq(&job, &error, None)?,
                        None => warn!("job {job_id} disappeared before DLQ move"),
                    }
                    return Ok(ResultOutcome::DeadLettered {
                        job_id,
                        task_name,
                        error,
                        timed_out,
                    });
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
                    Ok(ResultOutcome::Retry {
                        job_id,
                        task_name,
                        error,
                        retry_count,
                        timed_out,
                    })
                } else {
                    // Move to DLQ
                    match self.storage.get_job(&job_id)? {
                        Some(job) => self.dlq.move_to_dlq(&job, &error, None)?,
                        None => warn!("job {job_id} disappeared before DLQ move"),
                    }
                    Ok(ResultOutcome::DeadLettered {
                        job_id,
                        task_name,
                        error,
                        timed_out,
                    })
                }
            }
            JobResult::Cancelled {
                job_id,
                task_name,
                wall_time_ns,
            } => {
                // Clear execution claim
                if let Err(e) = self.storage.complete_execution(&job_id) {
                    error!("failed to clear execution claim for job {job_id}: {e}");
                }
                // Mark as cancelled, no retry
                if let Err(e) = self.storage.mark_cancelled(&job_id) {
                    error!("failed to mark job {job_id} as cancelled: {e}");
                }
                if let Err(e) =
                    self.storage
                        .record_metric(&task_name, &job_id, wall_time_ns, 0, false)
                {
                    error!("failed to record metric for cancelled job {job_id}: {e}");
                }
                Ok(ResultOutcome::Cancelled { job_id, task_name })
            }
        }
    }
}
