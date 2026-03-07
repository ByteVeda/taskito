use redis::Commands;

use super::{map_err, RedisStorage};
use crate::error::{QueueError, Result};
use crate::job::Job;

impl RedisStorage {
    pub fn archive_old_jobs(&self, cutoff_ms: i64) -> Result<u64> {
        let mut conn = self.conn()?;
        let mut count = 0u64;

        // Archive completed (2), dead (4), and cancelled (5) jobs
        for status_int in [2, 4, 5] {
            let status_key = self.key(&["jobs", "status", &status_int.to_string()]);
            let job_ids: Vec<String> = conn.smembers(&status_key).map_err(map_err)?;

            for id in &job_ids {
                if let Some(job) = self.load_job(&mut conn, id)? {
                    if let Some(completed_at) = job.completed_at {
                        if completed_at < cutoff_ms {
                            // Store in archive
                            let archived_key = self.key(&["archived", id]);
                            let archived_all = self.key(&["archived", "all"]);
                            let job_json = serde_json::to_string(&job)
                                .map_err(|e| QueueError::Other(e.to_string()))?;

                            let pipe = &mut redis::pipe();
                            pipe.set(&archived_key, &job_json);
                            pipe.zadd(&archived_all, id, completed_at as f64);
                            pipe.query::<()>(&mut conn).map_err(map_err)?;

                            // Delete original job
                            self.delete_job_fully(&mut conn, &job)?;
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
