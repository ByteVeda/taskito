use redis::Commands;

use super::{map_err, RedisStorage};
use crate::error::{QueueError, Result};
use crate::job::{Job, JobStatus};

impl RedisStorage {
    pub fn archive_old_jobs(&self, cutoff_ms: i64) -> Result<u64> {
        let mut conn = self.conn()?;
        let mut count = 0u64;

        // Sourcing statuses from the enum guarantees that any future reorder
        // or insertion in `JobStatus` doesn't silently change which buckets
        // get archived.
        for status in [JobStatus::Complete, JobStatus::Dead, JobStatus::Cancelled] {
            let status_key = self.key(&["jobs", "status", &(status as i32).to_string()]);
            let job_ids: Vec<String> = conn.smembers(&status_key).map_err(map_err)?;

            for id in &job_ids {
                if let Some(job) = self.load_job(&mut conn, id)? {
                    if let Some(completed_at) = job.completed_at {
                        if completed_at < cutoff_ms {
                            // Move the job out of every live index and into the
                            // archive (including the per-status archive set used
                            // by stats and list_jobs).
                            let old_status = job.status;
                            self.archive_job_immediately(&mut conn, &job, old_status)?;
                            count += 1;
                        }
                    }
                }
            }
        }

        Ok(count)
    }

    pub fn list_archived(&self, limit: i64, offset: i64) -> Result<Vec<Job>> {
        let mut conn = self.conn()?;
        let archived_all = self.key(&["archived", "all"]);

        let ids: Vec<String> = conn
            .zrevrangebyscore_limit(
                &archived_all,
                "+inf",
                "-inf",
                offset.max(0) as isize,
                limit.max(0) as isize,
            )
            .map_err(map_err)?;

        let mut jobs = Vec::new();
        for id in ids {
            let archived_key = self.key(&["archived", &id]);
            let data: Option<String> = conn.get(&archived_key).map_err(map_err)?;
            if let Some(d) = data {
                let job: Job =
                    serde_json::from_str(&d).map_err(|e| QueueError::Other(e.to_string()))?;
                jobs.push(job);
            }
        }

        Ok(jobs)
    }
}
