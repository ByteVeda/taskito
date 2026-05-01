//! Job state mutations: complete, fail, retry, cancel, cascade-cancel,
//! dependency lookups, and progress updates.

use redis::Commands;

use super::dequeue_score;
use crate::error::{QueueError, Result};
use crate::job::{now_millis, JobStatus};
use crate::storage::redis_backend::{map_err, RedisStorage};

impl RedisStorage {
    pub fn complete(&self, id: &str, result_bytes: Option<Vec<u8>>) -> Result<()> {
        let mut conn = self.conn()?;
        let mut job = self.get_job_required(id)?;

        if job.status != JobStatus::Running {
            return Err(QueueError::JobNotFound(id.to_string()));
        }

        let old_status = job.status;
        job.status = JobStatus::Complete;
        job.completed_at = Some(now_millis());
        job.result = result_bytes;
        self.save_job_and_move_status(&mut conn, &job, old_status)?;

        // Clean up unique key if present
        if let Some(ref uk) = job.unique_key {
            let unique_key = self.key(&["jobs", "unique", uk]);
            conn.del::<_, ()>(&unique_key).map_err(map_err)?;
        }

        Ok(())
    }

    pub fn fail(&self, id: &str, error: &str) -> Result<()> {
        let mut conn = self.conn()?;
        let mut job = self.get_job_required(id)?;

        if job.status != JobStatus::Running {
            return Err(QueueError::JobNotFound(id.to_string()));
        }

        let old_status = job.status;
        job.status = JobStatus::Failed;
        job.completed_at = Some(now_millis());
        job.error = Some(error.to_string());
        self.save_job_and_move_status(&mut conn, &job, old_status)?;

        Ok(())
    }

    pub fn retry(&self, id: &str, next_scheduled_at: i64) -> Result<()> {
        let mut conn = self.conn()?;
        let mut job = self.get_job_required(id)?;
        let old_status = job.status;

        job.status = JobStatus::Pending;
        job.scheduled_at = next_scheduled_at;
        job.retry_count = job.retry_count.saturating_add(1);
        job.started_at = None;
        job.completed_at = None;
        job.error = None;

        self.save_job_and_move_status(&mut conn, &job, old_status)?;

        // Re-add to pending queue
        let queue_key = self.key(&["queue", &job.queue, "pending"]);
        let score = dequeue_score(job.priority, job.scheduled_at);
        conn.zadd::<_, _, _, ()>(&queue_key, &job.id, score)
            .map_err(map_err)?;

        Ok(())
    }

    pub fn cancel_job(&self, id: &str) -> Result<bool> {
        let mut conn = self.conn()?;
        let job = match self.get_job(id)? {
            Some(j) => j,
            None => return Ok(false),
        };

        if job.status != JobStatus::Pending {
            return Ok(false);
        }

        let mut job = job;
        let old_status = job.status;
        job.status = JobStatus::Cancelled;
        job.completed_at = Some(now_millis());
        self.save_job_and_move_status(&mut conn, &job, old_status)?;

        // Remove from pending queue
        let queue_key = self.key(&["queue", &job.queue, "pending"]);
        conn.zrem::<_, _, ()>(&queue_key, &job.id)
            .map_err(map_err)?;

        // Cascade cancel dependents
        drop(conn);
        self.cascade_cancel(id, "dependency cancelled")?;

        Ok(true)
    }

    pub fn request_cancel(&self, id: &str) -> Result<bool> {
        let mut conn = self.conn()?;
        let mut job = match self.get_job(id)? {
            Some(j) => j,
            None => return Ok(false),
        };

        if job.status != JobStatus::Running {
            return Ok(false);
        }

        job.cancel_requested = true;
        let job_json = serde_json::to_string(&job).map_err(|e| QueueError::Other(e.to_string()))?;
        let job_key = self.key(&["job", id]);
        conn.set::<_, _, ()>(&job_key, &job_json).map_err(map_err)?;

        let cancel_set = self.key(&["jobs", "cancel_requested"]);
        conn.sadd::<_, _, ()>(&cancel_set, id).map_err(map_err)?;

        Ok(true)
    }

    pub fn is_cancel_requested(&self, id: &str) -> Result<bool> {
        let mut conn = self.conn()?;
        let cancel_set = self.key(&["jobs", "cancel_requested"]);
        let is_member: bool = conn.sismember(&cancel_set, id).map_err(map_err)?;
        Ok(is_member)
    }

    pub fn mark_cancelled(&self, id: &str) -> Result<()> {
        let mut conn = self.conn()?;
        let mut job = self.get_job_required(id)?;
        let old_status = job.status;

        job.status = JobStatus::Cancelled;
        job.completed_at = Some(now_millis());
        job.error = Some("cancelled by request".to_string());
        self.save_job_and_move_status(&mut conn, &job, old_status)?;

        // Clean up cancel request
        let cancel_set = self.key(&["jobs", "cancel_requested"]);
        conn.srem::<_, _, ()>(&cancel_set, id).map_err(map_err)?;

        Ok(())
    }

    pub fn cascade_cancel(&self, failed_job_id: &str, reason: &str) -> Result<()> {
        let now = now_millis();

        let mut queue: Vec<String> = vec![failed_job_id.to_string()];
        let mut visited = std::collections::HashSet::new();
        visited.insert(failed_job_id.to_string());
        let mut idx = 0;

        while idx < queue.len() {
            let current_id = queue[idx].clone();
            idx += 1;

            let dependents = self.get_dependents(&current_id)?;
            for dep_id in dependents {
                if visited.insert(dep_id.clone()) {
                    queue.push(dep_id);
                }
            }
        }

        // Remove the original job
        if !queue.is_empty() {
            queue.remove(0);
        }

        let error_msg = format!("{reason}: {failed_job_id}");
        for dep_id in &queue {
            if let Some(mut job) = self.get_job(dep_id)? {
                if job.status == JobStatus::Pending {
                    let mut conn = self.conn()?;
                    let old_status = job.status;
                    job.status = JobStatus::Cancelled;
                    job.completed_at = Some(now);
                    job.error = Some(error_msg.clone());
                    self.save_job_and_move_status(&mut conn, &job, old_status)?;

                    let queue_key = self.key(&["queue", &job.queue, "pending"]);
                    conn.zrem::<_, _, ()>(&queue_key, &job.id)
                        .map_err(map_err)?;
                }
            }
        }

        Ok(())
    }

    pub fn get_dependencies(&self, job_id: &str) -> Result<Vec<String>> {
        let mut conn = self.conn()?;
        let key = self.key(&["job", job_id, "depends_on"]);
        let ids: Vec<String> = conn.smembers(&key).map_err(map_err)?;
        Ok(ids)
    }

    pub fn get_dependents(&self, job_id: &str) -> Result<Vec<String>> {
        let mut conn = self.conn()?;
        let key = self.key(&["job", job_id, "dependents"]);
        let ids: Vec<String> = conn.smembers(&key).map_err(map_err)?;
        Ok(ids)
    }

    pub fn update_progress(&self, id: &str, progress: i32) -> Result<()> {
        if !(0..=100).contains(&progress) {
            return Err(QueueError::Other(
                "progress must be between 0 and 100".into(),
            ));
        }
        let mut conn = self.conn()?;
        let mut job = self.get_job_required(id)?;
        job.progress = Some(progress);
        let job_json = serde_json::to_string(&job).map_err(|e| QueueError::Other(e.to_string()))?;
        let job_key = self.key(&["job", id]);
        conn.set::<_, _, ()>(&job_key, &job_json).map_err(map_err)?;
        Ok(())
    }
}
