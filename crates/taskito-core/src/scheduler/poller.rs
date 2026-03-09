use std::time::Duration;

use log::warn;

use crate::error::Result;
use crate::job::{now_millis, Job};
use crate::storage::Storage;

use super::Scheduler;

/// Delay before re-scheduling a circuit-broken job (ms).
const CIRCUIT_BREAKER_RETRY_DELAY_MS: i64 = 5000;

/// Delay before re-scheduling a rate-limited job (ms).
const RATE_LIMIT_RETRY_DELAY_MS: i64 = 1000;

impl Scheduler {
    pub(super) fn try_dispatch(&self, job_tx: &tokio::sync::mpsc::Sender<Job>) -> Result<bool> {
        let now = now_millis();

        // Filter out paused queues (refresh cache every 1s)
        let active_queues = {
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
                self.queues.clone()
            } else {
                self.queues
                    .iter()
                    .filter(|q| !cache.0.contains(*q))
                    .cloned()
                    .collect::<Vec<_>>()
            }
        };

        if active_queues.is_empty() {
            return Ok(false);
        }

        let job = match self.storage.dequeue_from(&active_queues, now)? {
            Some(j) => j,
            None => return Ok(false),
        };

        // Check circuit breaker for this task
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

        // Claim exactly-once execution
        match self.storage.claim_execution(&job.id, "scheduler") {
            Ok(false) => {
                // Already claimed by another worker — skip
                return Ok(false);
            }
            Ok(true) => {}
            Err(e) => {
                warn!("claim_execution error for job {}: {e}", job.id);
                // Proceed anyway to avoid dropping the job
            }
        }

        // Dispatch to worker pool (non-blocking)
        if job_tx.try_send(job).is_err() {
            warn!("worker channel full or closed");
        }

        Ok(true)
    }
}
