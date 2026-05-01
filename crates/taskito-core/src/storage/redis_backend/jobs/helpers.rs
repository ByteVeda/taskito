//! Internal helpers shared by other job submodules.

use redis::Commands;

use crate::error::{QueueError, Result};
use crate::job::{Job, JobStatus};
use crate::storage::redis_backend::{map_err, RedisStorage};

impl RedisStorage {
    pub(in crate::storage::redis_backend) fn load_job(
        &self,
        conn: &mut redis::Connection,
        id: &str,
    ) -> Result<Option<Job>> {
        let job_key = self.key(&["job", id]);
        let data: Option<String> = conn.get(&job_key).map_err(map_err)?;
        match data {
            Some(d) => {
                let job: Job =
                    serde_json::from_str(&d).map_err(|e| QueueError::Other(e.to_string()))?;
                Ok(Some(job))
            }
            None => Ok(None),
        }
    }

    pub(super) fn get_job_required(&self, id: &str) -> Result<Job> {
        self.get_job(id)?
            .ok_or_else(|| QueueError::JobNotFound(id.to_string()))
    }

    /// Save job JSON and move between status sets.
    pub(in crate::storage::redis_backend) fn save_job_and_move_status(
        &self,
        conn: &mut redis::Connection,
        job: &Job,
        old_status: JobStatus,
    ) -> Result<()> {
        let job_json = serde_json::to_string(job).map_err(|e| QueueError::Other(e.to_string()))?;
        let job_key = self.key(&["job", &job.id]);
        let old_status_key = self.key(&["jobs", "status", &(old_status as i32).to_string()]);
        let new_status_key = self.key(&["jobs", "status", &(job.status as i32).to_string()]);

        let pipe = &mut redis::pipe();
        pipe.set(&job_key, &job_json);
        if old_status != job.status {
            pipe.srem(&old_status_key, &job.id);
            pipe.sadd(&new_status_key, &job.id);
        }
        pipe.query::<()>(conn).map_err(map_err)?;

        Ok(())
    }

    /// Delete a job and all its associated data.
    pub(in crate::storage::redis_backend) fn delete_job_fully(
        &self,
        conn: &mut redis::Connection,
        job: &Job,
    ) -> Result<()> {
        let pipe = &mut redis::pipe();

        let job_key = self.key(&["job", &job.id]);
        let status_key = self.key(&["jobs", "status", &(job.status as i32).to_string()]);
        let by_queue_key = self.key(&["jobs", "by_queue", &job.queue]);
        let by_task_key = self.key(&["jobs", "by_task", &job.task_name]);
        let all_key = self.key(&["jobs", "all"]);
        let errors_key = self.key(&["job_errors", &job.id]);
        let deps_key = self.key(&["job", &job.id, "depends_on"]);
        let dependents_key = self.key(&["job", &job.id, "dependents"]);

        pipe.del(&job_key);
        pipe.srem(&status_key, &job.id);
        pipe.srem(&by_queue_key, &job.id);
        pipe.srem(&by_task_key, &job.id);
        pipe.zrem(&all_key, &job.id);
        pipe.del(&errors_key);
        pipe.del(&deps_key);
        pipe.del(&dependents_key);

        if let Some(ref uk) = job.unique_key {
            let unique_key = self.key(&["jobs", "unique", uk]);
            pipe.del(&unique_key);
        }

        pipe.query::<()>(conn).map_err(map_err)?;

        Ok(())
    }
}
