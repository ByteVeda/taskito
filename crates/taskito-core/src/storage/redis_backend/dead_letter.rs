use redis::Commands;
use serde::{Deserialize, Serialize};

use super::{map_err, RedisStorage};
use crate::error::{QueueError, Result};
use crate::job::{now_millis, Job, JobStatus, NewJob};
use crate::storage::DeadJob;

#[derive(Serialize, Deserialize)]
struct DeadJobEntry {
    pub id: String,
    pub original_job_id: String,
    pub queue: String,
    pub task_name: String,
    pub payload: Vec<u8>,
    pub error: Option<String>,
    pub retry_count: i32,
    pub failed_at: i64,
    pub metadata: Option<String>,
    pub priority: i32,
    pub max_retries: i32,
    pub timeout_ms: i64,
    pub result_ttl_ms: Option<i64>,
}

impl From<DeadJobEntry> for DeadJob {
    fn from(e: DeadJobEntry) -> Self {
        Self {
            id: e.id,
            original_job_id: e.original_job_id,
            queue: e.queue,
            task_name: e.task_name,
            payload: e.payload,
            error: e.error,
            retry_count: e.retry_count,
            failed_at: e.failed_at,
            metadata: e.metadata,
            priority: e.priority,
            max_retries: e.max_retries,
            timeout_ms: e.timeout_ms,
            result_ttl_ms: e.result_ttl_ms,
        }
    }
}

impl RedisStorage {
    pub fn move_to_dlq(&self, job: &Job, error: &str, metadata: Option<&str>) -> Result<()> {
        let now = now_millis();
        let dlq_id = uuid::Uuid::now_v7().to_string();
        let mut conn = self.conn()?;

        let entry = DeadJobEntry {
            id: dlq_id.clone(),
            original_job_id: job.id.clone(),
            queue: job.queue.clone(),
            task_name: job.task_name.clone(),
            payload: job.payload.clone(),
            error: Some(error.to_string()),
            retry_count: job.retry_count,
            failed_at: now,
            metadata: metadata.map(|s| s.to_string()),
            priority: job.priority,
            max_retries: job.max_retries,
            timeout_ms: job.timeout_ms,
            result_ttl_ms: job.result_ttl_ms,
        };

        let json = serde_json::to_string(&entry).map_err(|e| QueueError::Other(e.to_string()))?;

        let dlq_key = self.key(&["dlq", &dlq_id]);
        let dlq_all = self.key(&["dlq", "all"]);

        let pipe = &mut redis::pipe();
        pipe.set(&dlq_key, &json);
        pipe.zadd(&dlq_all, &dlq_id, now as f64);
        pipe.query::<()>(&mut conn).map_err(map_err)?;

        // Update job status to Dead
        let mut dead_job = job.clone();
        let old_status = dead_job.status;
        dead_job.status = JobStatus::Dead;
        dead_job.error = Some(error.to_string());
        dead_job.completed_at = Some(now);
        self.save_job_and_move_status(&mut conn, &dead_job, old_status)?;

        // Cascade cancel dependents
        drop(conn);
        self.cascade_cancel(&job.id, "dependency failed")?;

        Ok(())
    }

    pub fn list_dead(&self, limit: i64, offset: i64) -> Result<Vec<DeadJob>> {
        let mut conn = self.conn()?;
        let dlq_all = self.key(&["dlq", "all"]);

        let ids: Vec<String> = conn
            .zrevrangebyscore_limit(&dlq_all, "+inf", "-inf", offset as isize, limit as isize)
            .map_err(map_err)?;

        let mut results = Vec::new();
        for id in ids {
            let dlq_key = self.key(&["dlq", &id]);
            let data: Option<String> = conn.get(&dlq_key).map_err(map_err)?;
            if let Some(d) = data {
                let entry: DeadJobEntry =
                    serde_json::from_str(&d).map_err(|e| QueueError::Other(e.to_string()))?;
                results.push(DeadJob::from(entry));
            }
        }

        Ok(results)
    }

    pub fn retry_dead(&self, dead_id: &str) -> Result<String> {
        let mut conn = self.conn()?;
        let dlq_key = self.key(&["dlq", dead_id]);

        let data: String = conn
            .get(&dlq_key)
            .map_err(map_err)
            .and_then(|v: Option<String>| {
                v.ok_or_else(|| QueueError::JobNotFound(dead_id.to_string()))
            })?;

        let entry: DeadJobEntry =
            serde_json::from_str(&data).map_err(|e| QueueError::Other(e.to_string()))?;

        let new_job = NewJob {
            queue: entry.queue,
            task_name: entry.task_name,
            payload: entry.payload,
            priority: entry.priority,
            scheduled_at: now_millis(),
            max_retries: entry.max_retries,
            timeout_ms: entry.timeout_ms,
            unique_key: None,
            metadata: entry.metadata,
            depends_on: vec![],
            expires_at: None,
            result_ttl_ms: entry.result_ttl_ms,
            namespace: None,
        };

        let job = self.enqueue(new_job)?;

        // Remove from DLQ
        let dlq_all = self.key(&["dlq", "all"]);
        let pipe = &mut redis::pipe();
        pipe.del(&dlq_key);
        pipe.zrem(&dlq_all, dead_id);
        pipe.query::<()>(&mut conn).map_err(map_err)?;

        Ok(job.id)
    }

    pub fn purge_dead(&self, older_than_ms: i64) -> Result<u64> {
        let mut conn = self.conn()?;
        let dlq_all = self.key(&["dlq", "all"]);

        // Get all DLQ IDs with scores <= older_than_ms
        let ids: Vec<String> = conn
            .zrangebyscore(&dlq_all, "-inf", older_than_ms as f64)
            .map_err(map_err)?;

        if ids.is_empty() {
            return Ok(0);
        }

        let pipe = &mut redis::pipe();
        for id in &ids {
            let dlq_key = self.key(&["dlq", id]);
            pipe.del(&dlq_key);
            pipe.zrem(&dlq_all, id);
        }
        pipe.query::<()>(&mut conn).map_err(map_err)?;

        Ok(ids.len() as u64)
    }
}
