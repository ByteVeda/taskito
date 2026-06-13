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
    #[serde(default)]
    pub notes: Option<String>,
    pub priority: i32,
    pub max_retries: i32,
    pub timeout_ms: i64,
    pub result_ttl_ms: Option<i64>,
    #[serde(default)]
    pub namespace: Option<String>,
    #[serde(default)]
    pub dlq_retry_count: i32,
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
            notes: e.notes,
            priority: e.priority,
            max_retries: e.max_retries,
            timeout_ms: e.timeout_ms,
            result_ttl_ms: e.result_ttl_ms,
            namespace: e.namespace,
            dlq_retry_count: e.dlq_retry_count,
        }
    }
}

impl RedisStorage {
    pub fn move_to_dlq(&self, job: &Job, error: &str, metadata: Option<&str>) -> Result<()> {
        let now = now_millis();
        let dlq_id = uuid::Uuid::now_v7().to_string();
        let mut conn = self.conn()?;

        let dlq_retry_count = job
            .metadata
            .as_deref()
            .and_then(|m| serde_json::from_str::<serde_json::Value>(m).ok())
            .and_then(|v| v.get("__dlq_retry_count")?.as_i64())
            .unwrap_or(0) as i32;

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
            notes: job.notes.clone(),
            priority: job.priority,
            max_retries: job.max_retries,
            timeout_ms: job.timeout_ms,
            result_ttl_ms: job.result_ttl_ms,
            namespace: job.namespace.clone(),
            dlq_retry_count,
        };

        let json = serde_json::to_string(&entry).map_err(|e| QueueError::Other(e.to_string()))?;

        let dlq_key = self.key(&["dlq", &dlq_id]);
        let dlq_all = self.key(&["dlq", "all"]);

        let mut dead_job = job.clone();
        let old_status = dead_job.status;
        dead_job.status = JobStatus::Dead;
        dead_job.error = Some(error.to_string());
        dead_job.completed_at = Some(now);
        let dead_json =
            serde_json::to_string(&dead_job).map_err(|e| QueueError::Other(e.to_string()))?;

        // Commit the DLQ entry and the live→archive move together, but only if the
        // job is still live in its expected state. A racing complete/fail or the
        // stale-job reaper may have archived it first; WATCH aborts the EXEC if
        // `job:<id>` changes between the liveness check and the commit, so we never
        // create a duplicate DLQ entry or overwrite a terminal archive.
        let job_live_key = self.key(&["job", &job.id]);
        let dead_lettered: bool =
            redis::transaction(&mut conn, &[job_live_key.as_str()], |conn, pipe| {
                if !conn.exists::<_, bool>(&job_live_key)? {
                    return Ok(Some(false));
                }
                pipe.set(&dlq_key, &json).ignore();
                pipe.zadd(&dlq_all, &dlq_id, now as f64).ignore();
                self.push_archive_ops(pipe, &dead_job, old_status, &dead_json);
                Ok(pipe.query::<Option<()>>(conn)?.map(|()| true))
            })
            .map_err(map_err)?;

        // Cascade-cancel dependents only if we actually dead-lettered the job
        // (skipped when a racer had already archived it).
        drop(conn);
        if dead_lettered {
            self.cascade_cancel(&job.id, "dependency failed")?;
        }

        Ok(())
    }

    pub fn list_dead(&self, limit: i64, offset: i64) -> Result<Vec<DeadJob>> {
        let mut conn = self.conn()?;
        let dlq_all = self.key(&["dlq", "all"]);

        let ids: Vec<String> = conn
            .zrevrangebyscore_limit(
                &dlq_all,
                "+inf",
                "-inf",
                offset.max(0) as isize,
                limit.max(0) as isize,
            )
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

        let retry_metadata = {
            let next_count = entry.dlq_retry_count + 1;
            let mut obj = entry
                .metadata
                .as_deref()
                .and_then(|m| {
                    serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(m).ok()
                })
                .unwrap_or_default();
            obj.insert(
                "__dlq_retry_count".to_string(),
                serde_json::Value::from(next_count),
            );
            Some(serde_json::to_string(&serde_json::Value::Object(obj)).unwrap_or_default())
        };

        let new_job = NewJob {
            queue: entry.queue,
            task_name: entry.task_name,
            payload: entry.payload,
            priority: entry.priority,
            scheduled_at: now_millis(),
            max_retries: entry.max_retries,
            timeout_ms: entry.timeout_ms,
            unique_key: None,
            metadata: retry_metadata,
            notes: entry.notes,
            depends_on: vec![],
            expires_at: None,
            result_ttl_ms: entry.result_ttl_ms,
            namespace: entry.namespace,
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

    pub fn delete_dead(&self, dead_id: &str) -> Result<bool> {
        let mut conn = self.conn()?;
        let dlq_key = self.key(&["dlq", dead_id]);
        let dlq_all = self.key(&["dlq", "all"]);

        let existed: bool = conn.exists(&dlq_key).map_err(map_err)?;
        if !existed {
            return Ok(false);
        }

        let pipe = &mut redis::pipe();
        pipe.del(&dlq_key);
        pipe.zrem(&dlq_all, dead_id);
        pipe.query::<()>(&mut conn).map_err(map_err)?;
        Ok(true)
    }

    pub fn purge_dead_with_ttl(&self, global_cutoff_ms: i64) -> Result<u64> {
        let mut conn = self.conn()?;
        let dlq_all = self.key(&["dlq", "all"]);
        let now = now_millis();

        let ids: Vec<String> = conn
            .zrangebyscore(&dlq_all, "-inf", "+inf")
            .map_err(map_err)?;

        let mut to_delete = Vec::new();
        for id in &ids {
            let dlq_key = self.key(&["dlq", id]);
            let data: Option<String> = conn.get(&dlq_key).map_err(map_err)?;
            if let Some(d) = data {
                if let Ok(entry) = serde_json::from_str::<DeadJobEntry>(&d) {
                    let expired = match entry.result_ttl_ms {
                        Some(ttl) => entry.failed_at + ttl <= now,
                        None => entry.failed_at < global_cutoff_ms,
                    };
                    if expired {
                        to_delete.push(id.clone());
                    }
                }
            }
        }

        if to_delete.is_empty() {
            return Ok(0);
        }

        let pipe = &mut redis::pipe();
        for id in &to_delete {
            pipe.del(self.key(&["dlq", id]));
            pipe.zrem(&dlq_all, id.as_str());
        }
        pipe.query::<()>(&mut conn).map_err(map_err)?;
        Ok(to_delete.len() as u64)
    }

    pub fn list_dead_for_retry(
        &self,
        cutoff_ms: i64,
        max_retries: i32,
        limit: i64,
    ) -> Result<Vec<DeadJob>> {
        let mut conn = self.conn()?;
        let dlq_all = self.key(&["dlq", "all"]);

        let ids: Vec<String> = conn
            .zrangebyscore(&dlq_all, "-inf", cutoff_ms as f64)
            .map_err(map_err)?;

        let mut results = Vec::new();
        for id in ids {
            if results.len() >= limit as usize {
                break;
            }
            let dlq_key = self.key(&["dlq", &id]);
            let data: Option<String> = conn.get(&dlq_key).map_err(map_err)?;
            if let Some(d) = data {
                if let Ok(entry) = serde_json::from_str::<DeadJobEntry>(&d) {
                    if entry.dlq_retry_count < max_retries {
                        results.push(DeadJob::from(entry));
                    }
                }
            }
        }

        Ok(results)
    }
}
