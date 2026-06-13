//! Job state mutations: complete, fail, retry, cancel, cascade-cancel,
//! dependency lookups, and progress updates.

use redis::Commands;

use crate::error::{QueueError, Result};
use crate::job::{now_millis, JobStatus};
use crate::storage::redis_backend::{map_err, RedisStorage};

/// Lua: write the precomputed job JSON only if the job is still live (its
/// `job:<id>` key exists). Guards `update_progress` so a concurrent archive
/// (complete/fail/reap) can't be clobbered into a resurrected orphan key that
/// belongs to no index. Returns 1 on write, 0 if the job is already gone.
const SET_IF_LIVE: &str = r#"
    if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
    redis.call('SET', KEYS[1], ARGV[1])
    return 1
"#;

/// Lua: mark a job cancel-requested (write JSON + add to the cancel set) only
/// if it is still live-Running (member of `jobs:status:1`). Prevents resurrecting
/// a job that was archived concurrently. Returns 1 if applied, 0 otherwise.
const REQUEST_CANCEL_IF_RUNNING: &str = r#"
    if redis.call('SISMEMBER', KEYS[2], ARGV[1]) == 0 then return 0 end
    redis.call('SET', KEYS[1], ARGV[2])
    redis.call('SADD', KEYS[3], ARGV[1])
    return 1
"#;

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
        self.archive_job_immediately(&mut conn, &job, old_status)?;

        // Release the unique-key pointer only if it still points at THIS job —
        // a concurrent enqueue_unique reusing the key after the archive removed
        // `job:<id>` may have already repointed it to a new job, whose dedup
        // lock an unconditional DEL would clobber.
        if let Some(ref uk) = job.unique_key {
            self.release_unique_key(&mut conn, uk, id)?;
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
        self.archive_job_immediately(&mut conn, &job, old_status)?;

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

        // Atomic status-move + pending-zset insert (see `requeue_pending`).
        self.requeue_pending(&mut conn, &job, old_status)?;

        Ok(())
    }

    /// Re-schedule a job back to `Pending` without consuming retry budget.
    /// Mirrors [`retry`](Self::retry) for soft-gate reschedules where the job
    /// never executed, so `retry_count` must be preserved.
    pub fn reschedule(&self, id: &str, next_scheduled_at: i64) -> Result<()> {
        let mut conn = self.conn()?;
        let mut job = self.get_job_required(id)?;
        let old_status = job.status;

        job.status = JobStatus::Pending;
        job.scheduled_at = next_scheduled_at;
        job.started_at = None;
        job.completed_at = None;
        job.error = None;

        // Atomic status-move + pending-zset insert (see `requeue_pending`).
        self.requeue_pending(&mut conn, &job, old_status)?;

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

        // `archive_job_immediately` removes the job from the per-queue pending
        // zset as part of its atomic live→archive move (old_status == Pending).
        self.archive_job_immediately(&mut conn, &job, old_status)?;

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
        let running_key = self.key(&["jobs", "status", &(JobStatus::Running as i32).to_string()]);
        let cancel_set = self.key(&["jobs", "cancel_requested"]);

        // Guarded write: only mark the job if it is still live-Running. If it was
        // archived between the read above and here, the script is a no-op (returns
        // 0) and we report "not cancellable" rather than resurrecting it.
        let applied: i32 = redis::Script::new(REQUEST_CANCEL_IF_RUNNING)
            .key(&job_key)
            .key(&running_key)
            .key(&cancel_set)
            .arg(id)
            .arg(&job_json)
            .invoke(&mut conn)
            .map_err(map_err)?;

        Ok(applied == 1)
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
        self.archive_job_immediately(&mut conn, &job, old_status)?;

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

                    // `archive_job_immediately` removes the job from the
                    // per-queue pending zset as part of its atomic move.
                    self.archive_job_immediately(&mut conn, &job, old_status)?;
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

        // Guarded write: only update if `job:<id>` still exists. If the job was
        // archived (completed/failed/reaped) between the read and here, the plain
        // SET would otherwise recreate it as a Running orphan outside every index.
        let applied: i32 = redis::Script::new(SET_IF_LIVE)
            .key(&job_key)
            .arg(&job_json)
            .invoke(&mut conn)
            .map_err(map_err)?;
        if applied == 0 {
            // The job was archived concurrently — surface it like the read path
            // rather than reporting a silent success that wrote nothing.
            return Err(QueueError::JobNotFound(id.to_string()));
        }
        Ok(())
    }
}
