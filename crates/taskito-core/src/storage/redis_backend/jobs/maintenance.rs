//! Periodic maintenance: purge completed jobs, reap stale running jobs,
//! expire pending jobs, cancel by queue/task name.

use redis::Commands;

use crate::error::Result;
use crate::job::{now_millis, Job, JobStatus};
use crate::storage::redis_backend::{map_err, RedisStorage};

impl RedisStorage {
    pub fn purge_completed(&self, older_than_ms: i64) -> Result<u64> {
        let mut conn = self.conn()?;
        let status_key = self.key(&["jobs", "status", "2"]); // Complete
        let job_ids: Vec<String> = conn.smembers(&status_key).map_err(map_err)?;

        let mut count = 0u64;
        for id in &job_ids {
            if let Some(job) = self.load_job(&mut conn, id)? {
                if let Some(completed_at) = job.completed_at {
                    if completed_at < older_than_ms {
                        self.delete_job_fully(&mut conn, &job)?;
                        count += 1;
                    }
                }
            }
        }

        Ok(count)
    }

    pub fn purge_completed_with_ttl(&self, global_cutoff_ms: i64) -> Result<u64> {
        let now = now_millis();
        let mut conn = self.conn()?;
        let status_key = self.key(&["jobs", "status", "2"]); // Complete
        let job_ids: Vec<String> = conn.smembers(&status_key).map_err(map_err)?;

        let mut count = 0u64;
        for id in &job_ids {
            if let Some(job) = self.load_job(&mut conn, id)? {
                let should_purge = match (job.completed_at, job.result_ttl_ms) {
                    (Some(completed), Some(ttl)) => completed
                        .checked_add(ttl)
                        .is_some_and(|expiry| expiry < now),
                    (Some(completed), None) => completed < global_cutoff_ms,
                    _ => false,
                };
                if should_purge {
                    self.delete_job_fully(&mut conn, &job)?;
                    count += 1;
                }
            }
        }

        Ok(count)
    }

    pub fn reap_stale_jobs(&self, now: i64) -> Result<Vec<Job>> {
        let mut conn = self.conn()?;
        let status_key = self.key(&["jobs", "status", "1"]); // Running
        let job_ids: Vec<String> = conn.smembers(&status_key).map_err(map_err)?;

        let mut stale = Vec::new();
        for id in &job_ids {
            if let Some(job) = self.load_job(&mut conn, id)? {
                if let Some(started) = job.started_at {
                    let timed_out = match started.checked_add(job.timeout_ms) {
                        Some(deadline) => deadline < now,
                        None => true,
                    };
                    if timed_out {
                        stale.push(job);
                    }
                }
            }
        }

        Ok(stale)
    }

    pub fn expire_pending_jobs(&self, now: i64) -> Result<u64> {
        let mut conn = self.conn()?;
        let status_key = self.key(&["jobs", "status", "0"]); // Pending
        let job_ids: Vec<String> = conn.smembers(&status_key).map_err(map_err)?;

        let mut count = 0u64;
        for id in &job_ids {
            if let Some(mut job) = self.load_job(&mut conn, id)? {
                if let Some(expires_at) = job.expires_at {
                    if expires_at < now {
                        let old_status = job.status;
                        job.status = JobStatus::Cancelled;
                        job.completed_at = Some(now);
                        job.error = Some("expired".to_string());
                        self.save_job_and_move_status(&mut conn, &job, old_status)?;

                        let queue_key = self.key(&["queue", &job.queue, "pending"]);
                        conn.zrem::<_, _, ()>(&queue_key, &job.id)
                            .map_err(map_err)?;
                        count += 1;
                    }
                }
            }
        }

        Ok(count)
    }

    pub fn cancel_pending_by_queue(&self, queue: &str) -> Result<u64> {
        let mut conn = self.conn()?;
        let by_queue_key = self.key(&["jobs", "by_queue", queue]);
        let job_ids: Vec<String> = conn.smembers(&by_queue_key).map_err(map_err)?;
        let now = now_millis();

        let mut count = 0u64;
        for id in &job_ids {
            if let Some(mut job) = self.load_job(&mut conn, id)? {
                if job.status == JobStatus::Pending {
                    let old_status = job.status;
                    job.status = JobStatus::Cancelled;
                    job.completed_at = Some(now);
                    job.error = Some("purged".to_string());
                    self.save_job_and_move_status(&mut conn, &job, old_status)?;

                    let queue_key = self.key(&["queue", &job.queue, "pending"]);
                    conn.zrem::<_, _, ()>(&queue_key, &job.id)
                        .map_err(map_err)?;
                    count += 1;
                }
            }
        }

        Ok(count)
    }

    pub fn cancel_pending_by_task(&self, task_name: &str) -> Result<u64> {
        let mut conn = self.conn()?;
        let by_task_key = self.key(&["jobs", "by_task", task_name]);
        let job_ids: Vec<String> = conn.smembers(&by_task_key).map_err(map_err)?;
        let now = now_millis();

        let mut count = 0u64;
        for id in &job_ids {
            if let Some(mut job) = self.load_job(&mut conn, id)? {
                if job.status == JobStatus::Pending {
                    let old_status = job.status;
                    job.status = JobStatus::Cancelled;
                    job.completed_at = Some(now);
                    job.error = Some("revoked".to_string());
                    self.save_job_and_move_status(&mut conn, &job, old_status)?;

                    let queue_key = self.key(&["queue", &job.queue, "pending"]);
                    conn.zrem::<_, _, ()>(&queue_key, &job.id)
                        .map_err(map_err)?;
                    count += 1;
                }
            }
        }

        Ok(count)
    }
}
