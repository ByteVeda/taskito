//! Read-only queries: get_job, list_jobs, list_jobs_filtered, stats.

use redis::Commands;

use crate::error::Result;
use crate::job::{Job, JobStatus};
use crate::storage::redis_backend::{map_err, RedisStorage};
use crate::storage::QueueStats;

impl RedisStorage {
    pub fn list_jobs(
        &self,
        status: Option<i32>,
        queue_name: Option<&str>,
        task_name: Option<&str>,
        limit: i64,
        offset: i64,
        namespace: Option<&str>,
    ) -> Result<Vec<Job>> {
        let mut conn = self.conn()?;

        // Get candidate job IDs based on filters
        let job_ids: Vec<String> = if let Some(s) = status {
            let key = self.key(&["jobs", "status", &s.to_string()]);
            conn.smembers(&key).map_err(map_err)?
        } else if let Some(q) = queue_name {
            let key = self.key(&["jobs", "by_queue", q]);
            conn.smembers(&key).map_err(map_err)?
        } else if let Some(t) = task_name {
            let key = self.key(&["jobs", "by_task", t]);
            conn.smembers(&key).map_err(map_err)?
        } else {
            // All jobs sorted by created_at desc
            let all_key = self.key(&["jobs", "all"]);
            let ids: Vec<String> = conn
                .zrangebyscore_limit(
                    &all_key,
                    "-inf",
                    "+inf",
                    offset.max(0) as isize,
                    limit.max(0) as isize,
                )
                .map_err(map_err)?;
            // Load and return directly since already paginated
            let mut jobs = Vec::new();
            for id in &ids {
                if let Some(job) = self.load_job(&mut conn, id)? {
                    if let Some(ns) = namespace {
                        if job.namespace.as_deref() != Some(ns) {
                            continue;
                        }
                    }
                    jobs.push(job);
                }
            }
            return Ok(jobs);
        };

        // Load all matching jobs and apply additional filters
        let mut jobs = Vec::new();
        for id in &job_ids {
            if let Some(job) = self.load_job(&mut conn, id)? {
                // Apply all filters
                if let Some(s) = status {
                    if job.status as i32 != s {
                        continue;
                    }
                }
                if let Some(q) = queue_name {
                    if job.queue != q {
                        continue;
                    }
                }
                if let Some(t) = task_name {
                    if job.task_name != t {
                        continue;
                    }
                }
                if let Some(ns) = namespace {
                    if job.namespace.as_deref() != Some(ns) {
                        continue;
                    }
                }
                jobs.push(job);
            }
        }

        // Sort by created_at desc
        jobs.sort_by_key(|j| std::cmp::Reverse(j.created_at));

        // Apply pagination
        let start = (offset.max(0) as usize).min(jobs.len());
        let end = start.saturating_add(limit.max(0) as usize).min(jobs.len());
        Ok(jobs[start..end].to_vec())
    }

    pub fn get_job(&self, id: &str) -> Result<Option<Job>> {
        let mut conn = self.conn()?;
        self.load_job(&mut conn, id)
    }

    pub fn stats(&self) -> Result<QueueStats> {
        let mut conn = self.conn()?;
        let mut stats = QueueStats::default();

        for (status_int, field) in [
            (0, &mut stats.pending),
            (1, &mut stats.running),
            (2, &mut stats.completed),
            (3, &mut stats.failed),
            (4, &mut stats.dead),
            (5, &mut stats.cancelled),
        ] {
            let key = self.key(&["jobs", "status", &status_int.to_string()]);
            let count: i64 = conn.scard(&key).map_err(map_err)?;
            *field = count;
        }

        Ok(stats)
    }

    /// `SINTERCARD` of a membership set with a per-status set — the count of
    /// jobs that are both in `membership_key` and in the given status, computed
    /// server-side without transferring or deserializing any job. Redis starts
    /// from the smaller set, so e.g. intersecting against the (small) running
    /// set stays cheap regardless of how large the membership set has grown.
    fn count_in_status(
        &self,
        conn: &mut redis::Connection,
        membership_key: &str,
        status: JobStatus,
    ) -> Result<i64> {
        let status_key = self.key(&["jobs", "status", &(status as i32).to_string()]);
        redis::cmd("SINTERCARD")
            .arg(2)
            .arg(membership_key)
            .arg(&status_key)
            .query::<i64>(conn)
            .map_err(map_err)
    }

    /// Per-status breakdown for the jobs in `membership_key` (a per-queue or
    /// per-task set), one `SINTERCARD` per status.
    fn status_breakdown(
        &self,
        conn: &mut redis::Connection,
        membership_key: &str,
    ) -> Result<QueueStats> {
        let mut stats = QueueStats::default();
        for (status, field) in [
            (JobStatus::Pending, &mut stats.pending),
            (JobStatus::Running, &mut stats.running),
            (JobStatus::Complete, &mut stats.completed),
            (JobStatus::Failed, &mut stats.failed),
            (JobStatus::Dead, &mut stats.dead),
            (JobStatus::Cancelled, &mut stats.cancelled),
        ] {
            *field = self.count_in_status(conn, membership_key, status)?;
        }
        Ok(stats)
    }

    /// Count running jobs for a specific task name (for per-task concurrency limiting).
    pub fn count_running_by_task(&self, task_name: &str) -> Result<i64> {
        let mut conn = self.conn()?;
        let by_task_key = self.key(&["jobs", "by_task", task_name]);
        self.count_in_status(&mut conn, &by_task_key, JobStatus::Running)
    }

    pub fn stats_by_queue(&self, queue_name: &str) -> Result<QueueStats> {
        let mut conn = self.conn()?;
        let by_queue_key = self.key(&["jobs", "by_queue", queue_name]);
        self.status_breakdown(&mut conn, &by_queue_key)
    }

    pub fn stats_all_queues(&self) -> Result<std::collections::HashMap<String, QueueStats>> {
        let mut conn = self.conn()?;

        // Enumerate queues by scanning the per-queue membership keys (one per
        // queue with at least one job — empty sets are auto-removed by Redis).
        // This is bounded by the number of queues, not the job population.
        let pattern = self.key(&["jobs", "by_queue", "*"]);
        let strip = self.key(&["jobs", "by_queue", ""]);
        let mut queues: Vec<String> = Vec::new();
        let mut cursor = 0u64;
        loop {
            let (next, batch): (u64, Vec<String>) = redis::cmd("SCAN")
                .arg(cursor)
                .arg("MATCH")
                .arg(&pattern)
                .arg("COUNT")
                .arg(100)
                .query(&mut conn)
                .map_err(map_err)?;
            for key in batch {
                if let Some(name) = key.strip_prefix(&strip) {
                    queues.push(name.to_string());
                }
            }
            cursor = next;
            if cursor == 0 {
                break;
            }
        }
        // SCAN may return duplicates across iterations.
        queues.sort_unstable();
        queues.dedup();

        let mut map = std::collections::HashMap::<String, QueueStats>::new();
        for queue in queues {
            let by_queue_key = self.key(&["jobs", "by_queue", &queue]);
            let stats = self.status_breakdown(&mut conn, &by_queue_key)?;
            map.insert(queue, stats);
        }
        Ok(map)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn list_jobs_filtered(
        &self,
        status: Option<i32>,
        queue_name: Option<&str>,
        task_name: Option<&str>,
        metadata_like: Option<&str>,
        error_like: Option<&str>,
        created_after: Option<i64>,
        created_before: Option<i64>,
        limit: i64,
        offset: i64,
        namespace: Option<&str>,
    ) -> Result<Vec<Job>> {
        let mut conn = self.conn()?;

        // Get candidate job IDs from the narrowest index available
        let job_ids: Vec<String> = if let Some(s) = status {
            let key = self.key(&["jobs", "status", &s.to_string()]);
            conn.smembers(&key).map_err(map_err)?
        } else if let Some(q) = queue_name {
            let key = self.key(&["jobs", "by_queue", q]);
            conn.smembers(&key).map_err(map_err)?
        } else if let Some(t) = task_name {
            let key = self.key(&["jobs", "by_task", t]);
            conn.smembers(&key).map_err(map_err)?
        } else {
            let all_key = self.key(&["jobs", "all"]);
            conn.zrange(&all_key, 0, -1).map_err(map_err)?
        };

        let mut jobs = Vec::new();
        for id in &job_ids {
            if let Some(job) = self.load_job(&mut conn, id)? {
                if let Some(s) = status {
                    if job.status as i32 != s {
                        continue;
                    }
                }
                if let Some(q) = queue_name {
                    if job.queue != q {
                        continue;
                    }
                }
                if let Some(t) = task_name {
                    if job.task_name != t {
                        continue;
                    }
                }
                if let Some(m) = metadata_like {
                    match &job.metadata {
                        Some(meta) if meta.contains(m) => {}
                        _ => continue,
                    }
                }
                if let Some(e) = error_like {
                    match &job.error {
                        Some(err) if err.contains(e) => {}
                        _ => continue,
                    }
                }
                if let Some(after) = created_after {
                    if job.created_at < after {
                        continue;
                    }
                }
                if let Some(before) = created_before {
                    if job.created_at > before {
                        continue;
                    }
                }
                if let Some(ns) = namespace {
                    if job.namespace.as_deref() != Some(ns) {
                        continue;
                    }
                }
                jobs.push(job);
            }
        }

        jobs.sort_by_key(|j| std::cmp::Reverse(j.created_at));

        let start = (offset.max(0) as usize).min(jobs.len());
        let end = start.saturating_add(limit.max(0) as usize).min(jobs.len());
        Ok(jobs[start..end].to_vec())
    }
}
