//! Dequeue jobs from one or more queues.

use redis::Commands;

use crate::error::{QueueError, Result};
use crate::job::{Job, JobStatus};
use crate::storage::redis_backend::{map_err, RedisStorage};

impl RedisStorage {
    pub fn dequeue(
        &self,
        queue_name: &str,
        now: i64,
        namespace: Option<&str>,
    ) -> Result<Option<Job>> {
        let mut conn = self.conn()?;
        let queue_key = self.key(&["queue", queue_name, "pending"]);

        // Get candidates ordered by score (lowest first = highest priority)
        let candidates: Vec<String> = conn
            .zrangebyscore_limit(&queue_key, "-inf", "+inf", 0, 100)
            .map_err(map_err)?;

        if candidates.is_empty() {
            return Ok(None);
        }

        // Batch-load every candidate's JSON in one MGET instead of one GET per
        // candidate.
        let job_keys: Vec<String> = candidates.iter().map(|id| self.key(&["job", id])).collect();
        let blobs: Vec<Option<String>> = conn.mget(&job_keys).map_err(map_err)?;

        for (job_id, data) in candidates.into_iter().zip(blobs) {
            let data = match data {
                Some(d) => d,
                None => {
                    // Stale entry — remove from queue
                    conn.zrem::<_, _, ()>(&queue_key, &job_id)
                        .map_err(map_err)?;
                    continue;
                }
            };

            let mut job: Job =
                serde_json::from_str(&data).map_err(|e| QueueError::Other(e.to_string()))?;

            // Must be pending and scheduled_at <= now
            if job.status != JobStatus::Pending || job.scheduled_at > now {
                continue;
            }

            // Filter by namespace: Some(ns) matches that namespace, None matches only jobs without a namespace
            if let Some(ns) = namespace {
                if job.namespace.as_deref() != Some(ns) {
                    continue;
                }
            } else if job.namespace.is_some() {
                continue;
            }

            // Skip expired jobs
            if let Some(expires_at) = job.expires_at {
                if now > expires_at {
                    job.status = JobStatus::Cancelled;
                    job.completed_at = Some(now);
                    job.error = Some("expired before execution".to_string());
                    self.save_job_and_move_status(&mut conn, &job, JobStatus::Pending)?;
                    conn.zrem::<_, _, ()>(&queue_key, &job_id)
                        .map_err(map_err)?;
                    continue;
                }
            }

            // Check dependencies — only for jobs that actually have them, and
            // resolve them on the existing connection rather than opening a new
            // one per dependency.
            if job.has_deps {
                let deps_key = self.key(&["job", &job_id, "depends_on"]);
                let dep_ids: Vec<String> = conn.smembers(&deps_key).map_err(map_err)?;
                if !dep_ids.is_empty() {
                    let mut all_complete = true;
                    for dep_id in &dep_ids {
                        if let Some(dep_job) = self.load_job(&mut conn, dep_id)? {
                            if dep_job.status != JobStatus::Complete {
                                all_complete = false;
                                break;
                            }
                        } else {
                            all_complete = false;
                            break;
                        }
                    }
                    if !all_complete {
                        continue;
                    }
                }
            }

            // Claim the job
            job.status = JobStatus::Running;
            job.started_at = Some(now);
            self.save_job_and_move_status(&mut conn, &job, JobStatus::Pending)?;
            conn.zrem::<_, _, ()>(&queue_key, &job_id)
                .map_err(map_err)?;

            return Ok(Some(job));
        }

        Ok(None)
    }

    pub fn dequeue_from(
        &self,
        queues: &[String],
        now: i64,
        namespace: Option<&str>,
    ) -> Result<Option<Job>> {
        for queue_name in queues {
            if let Some(job) = self.dequeue(queue_name, now, namespace)? {
                return Ok(Some(job));
            }
        }
        Ok(None)
    }
}
