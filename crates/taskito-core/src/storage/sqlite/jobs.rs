use diesel::prelude::*;
use diesel::sqlite::SqliteConnection;

use super::super::models::*;
use super::super::schema::{
    job_dependencies, job_errors, jobs, replay_history, task_logs, task_metrics,
};
use super::SqliteStorage;
use crate::error::{QueueError, Result};
use crate::job::{now_millis, Job, JobStatus, NewJob};
use crate::storage::QueueStats;

fn delete_job_children(
    conn: &mut SqliteConnection,
    job_ids: &[String],
) -> diesel::result::QueryResult<()> {
    if job_ids.is_empty() {
        return Ok(());
    }

    diesel::delete(job_errors::table.filter(job_errors::job_id.eq_any(job_ids))).execute(conn)?;
    diesel::delete(task_logs::table.filter(task_logs::job_id.eq_any(job_ids))).execute(conn)?;
    diesel::delete(task_metrics::table.filter(task_metrics::job_id.eq_any(job_ids)))
        .execute(conn)?;
    diesel::delete(
        job_dependencies::table.filter(
            job_dependencies::job_id
                .eq_any(job_ids)
                .or(job_dependencies::depends_on_job_id.eq_any(job_ids)),
        ),
    )
    .execute(conn)?;
    diesel::delete(replay_history::table.filter(replay_history::original_job_id.eq_any(job_ids)))
        .execute(conn)?;

    Ok(())
}

impl SqliteStorage {
    /// Insert a new job into the queue. Returns the job.
    pub fn enqueue(&self, new_job: NewJob) -> Result<Job> {
        let depends_on = new_job.depends_on.clone();
        let job = new_job.into_job();
        let mut conn = self.conn()?;

        conn.transaction(|conn| {
            // Validate dependencies exist and aren't dead/cancelled
            for dep_id in &depends_on {
                let dep: Option<JobRow> = jobs::table
                    .find(dep_id)
                    .select(JobRow::as_select())
                    .first(conn)
                    .optional()?;

                match dep {
                    None => return Err(diesel::result::Error::RollbackTransaction),
                    Some(d)
                        if d.status == JobStatus::Dead as i32
                            || d.status == JobStatus::Cancelled as i32 =>
                    {
                        return Err(diesel::result::Error::RollbackTransaction);
                    }
                    _ => {}
                }
            }

            let row = NewJobRow {
                id: &job.id,
                queue: &job.queue,
                task_name: &job.task_name,
                payload: &job.payload,
                status: job.status as i32,
                priority: job.priority,
                created_at: job.created_at,
                scheduled_at: job.scheduled_at,
                retry_count: job.retry_count,
                max_retries: job.max_retries,
                timeout_ms: job.timeout_ms,
                unique_key: job.unique_key.as_deref(),
                metadata: job.metadata.as_deref(),
                cancel_requested: 0,
                expires_at: job.expires_at,
                result_ttl_ms: job.result_ttl_ms,
                namespace: job.namespace.as_deref(),
            };

            diesel::insert_into(jobs::table)
                .values(&row)
                .execute(conn)?;

            // Insert dependency rows
            for dep_id in &depends_on {
                let dep_row = NewJobDependencyRow {
                    id: &uuid::Uuid::now_v7().to_string(),
                    job_id: &job.id,
                    depends_on_job_id: dep_id,
                };
                diesel::insert_into(job_dependencies::table)
                    .values(&dep_row)
                    .execute(conn)?;
            }

            Ok(())
        })
        .map_err(|e| match e {
            diesel::result::Error::RollbackTransaction => QueueError::DependencyNotFound(
                "dependency not found or already dead/cancelled".to_string(),
            ),
            other => QueueError::Storage(other),
        })?;

        Ok(job)
    }

    /// Enqueue multiple jobs in a single transaction.
    pub fn enqueue_batch(&self, new_jobs: Vec<NewJob>) -> Result<Vec<Job>> {
        let mut conn = self.conn()?;
        let jobs: Vec<Job> = new_jobs.into_iter().map(|nj| nj.into_job()).collect();

        conn.transaction(|conn| {
            for job in &jobs {
                let row = NewJobRow {
                    id: &job.id,
                    queue: &job.queue,
                    task_name: &job.task_name,
                    payload: &job.payload,
                    status: job.status as i32,
                    priority: job.priority,
                    created_at: job.created_at,
                    scheduled_at: job.scheduled_at,
                    retry_count: job.retry_count,
                    max_retries: job.max_retries,
                    timeout_ms: job.timeout_ms,
                    unique_key: job.unique_key.as_deref(),
                    metadata: job.metadata.as_deref(),
                    cancel_requested: 0,
                    expires_at: job.expires_at,
                    result_ttl_ms: job.result_ttl_ms,
                    namespace: job.namespace.as_deref(),
                };

                diesel::insert_into(jobs::table)
                    .values(&row)
                    .execute(conn)?;
            }
            Ok(jobs)
        })
    }

    /// Enqueue with unique_key deduplication. Returns existing job if duplicate.
    pub fn enqueue_unique(&self, new_job: NewJob) -> Result<Job> {
        let depends_on = new_job.depends_on.clone();
        let job = new_job.into_job();
        let mut conn = self.conn()?;

        let result = conn.transaction(|conn| {
            // Check for existing active job with same unique_key
            if let Some(ref uk) = job.unique_key {
                let existing: Option<JobRow> = jobs::table
                    .filter(jobs::unique_key.eq(uk))
                    .filter(
                        jobs::status.eq_any([JobStatus::Pending as i32, JobStatus::Running as i32]),
                    )
                    .select(JobRow::as_select())
                    .first(conn)
                    .optional()?;

                if let Some(row) = existing {
                    return Ok(Job::from(row));
                }
            }

            let row = NewJobRow {
                id: &job.id,
                queue: &job.queue,
                task_name: &job.task_name,
                payload: &job.payload,
                status: job.status as i32,
                priority: job.priority,
                created_at: job.created_at,
                scheduled_at: job.scheduled_at,
                retry_count: job.retry_count,
                max_retries: job.max_retries,
                timeout_ms: job.timeout_ms,
                unique_key: job.unique_key.as_deref(),
                metadata: job.metadata.as_deref(),
                cancel_requested: 0,
                expires_at: job.expires_at,
                result_ttl_ms: job.result_ttl_ms,
                namespace: job.namespace.as_deref(),
            };

            diesel::insert_into(jobs::table)
                .values(&row)
                .execute(conn)?;

            // Insert dependency rows
            for dep_id in &depends_on {
                let dep_row = NewJobDependencyRow {
                    id: &uuid::Uuid::now_v7().to_string(),
                    job_id: &job.id,
                    depends_on_job_id: dep_id,
                };
                diesel::insert_into(job_dependencies::table)
                    .values(&dep_row)
                    .execute(conn)?;
            }

            Ok(job.clone())
        });

        // Handle unique constraint violation by returning existing job
        match result {
            Ok(j) => Ok(j),
            Err(diesel::result::Error::DatabaseError(
                diesel::result::DatabaseErrorKind::UniqueViolation,
                _,
            )) => {
                if let Some(ref uk) = job.unique_key {
                    let mut conn = self.conn()?;
                    let existing: Option<JobRow> = jobs::table
                        .filter(jobs::unique_key.eq(uk))
                        .filter(
                            jobs::status
                                .eq_any([JobStatus::Pending as i32, JobStatus::Running as i32]),
                        )
                        .select(JobRow::as_select())
                        .first(&mut conn)
                        .optional()?;
                    if let Some(row) = existing {
                        return Ok(Job::from(row));
                    }
                }
                Ok(job)
            }
            Err(e) => Err(QueueError::Storage(e)),
        }
    }

    /// Check if all dependencies for a job are complete.
    fn deps_satisfied(
        conn: &mut SqliteConnection,
        job_id: &str,
    ) -> diesel::result::QueryResult<bool> {
        let dep_job_ids: Vec<String> = job_dependencies::table
            .filter(job_dependencies::job_id.eq(job_id))
            .select(job_dependencies::depends_on_job_id)
            .load(conn)?;

        if dep_job_ids.is_empty() {
            return Ok(true);
        }

        let incomplete: i64 = jobs::table
            .filter(jobs::id.eq_any(&dep_job_ids))
            .filter(jobs::status.ne(JobStatus::Complete as i32))
            .count()
            .get_result(conn)?;

        Ok(incomplete == 0)
    }

    /// Atomically dequeue the highest-priority ready job from the given queue.
    /// Skips expired jobs.
    pub fn dequeue(&self, queue_name: &str, now: i64) -> Result<Option<Job>> {
        let mut conn = self.conn()?;

        conn.transaction(|conn| {
            let candidates: Vec<JobRow> = jobs::table
                .filter(jobs::queue.eq(queue_name))
                .filter(jobs::status.eq(JobStatus::Pending as i32))
                .filter(jobs::scheduled_at.le(now))
                .order((jobs::priority.desc(), jobs::scheduled_at.asc()))
                .limit(100)
                .select(JobRow::as_select())
                .load(conn)?;

            for row in candidates {
                // Skip expired jobs
                if let Some(expires_at) = row.expires_at {
                    if now > expires_at {
                        // Mark as cancelled (expired)
                        diesel::update(jobs::table)
                            .filter(jobs::id.eq(&row.id))
                            .set((
                                jobs::status.eq(JobStatus::Cancelled as i32),
                                jobs::completed_at.eq(now),
                                jobs::error.eq("expired before execution"),
                            ))
                            .execute(conn)?;
                        continue;
                    }
                }

                if !Self::deps_satisfied(conn, &row.id)? {
                    continue;
                }

                diesel::update(jobs::table)
                    .filter(jobs::id.eq(&row.id))
                    .filter(jobs::status.eq(JobStatus::Pending as i32))
                    .set((
                        jobs::status.eq(JobStatus::Running as i32),
                        jobs::started_at.eq(now),
                    ))
                    .execute(conn)?;

                let updated: JobRow = jobs::table
                    .find(&row.id)
                    .select(JobRow::as_select())
                    .first(conn)?;

                return Ok(Some(Job::from(updated)));
            }

            Ok(None)
        })
    }

    /// Dequeue from multiple queues, checking each in order.
    pub fn dequeue_from(&self, queues: &[String], now: i64) -> Result<Option<Job>> {
        for queue_name in queues {
            if let Some(job) = self.dequeue(queue_name, now)? {
                return Ok(Some(job));
            }
        }
        Ok(None)
    }

    /// Mark a job as complete with the given result.
    pub fn complete(&self, id: &str, result_bytes: Option<Vec<u8>>) -> Result<()> {
        let now = now_millis();
        let mut conn = self.conn()?;

        let affected = diesel::update(jobs::table)
            .filter(jobs::id.eq(id))
            .filter(jobs::status.eq(JobStatus::Running as i32))
            .set((
                jobs::status.eq(JobStatus::Complete as i32),
                jobs::completed_at.eq(now),
                jobs::result.eq(result_bytes),
            ))
            .execute(&mut conn)?;

        if affected == 0 {
            return Err(QueueError::JobNotFound(id.to_string()));
        }
        Ok(())
    }

    /// Mark a job as failed with the given error message.
    pub fn fail(&self, id: &str, error: &str) -> Result<()> {
        let now = now_millis();
        let mut conn = self.conn()?;

        let affected = diesel::update(jobs::table)
            .filter(jobs::id.eq(id))
            .filter(jobs::status.eq(JobStatus::Running as i32))
            .set((
                jobs::status.eq(JobStatus::Failed as i32),
                jobs::completed_at.eq(now),
                jobs::error.eq(error),
            ))
            .execute(&mut conn)?;

        if affected == 0 {
            return Err(QueueError::JobNotFound(id.to_string()));
        }
        Ok(())
    }

    /// Re-schedule a job for retry.
    pub fn retry(&self, id: &str, next_scheduled_at: i64) -> Result<()> {
        let mut conn = self.conn()?;

        let affected = diesel::update(jobs::table)
            .filter(jobs::id.eq(id))
            .set((
                jobs::status.eq(JobStatus::Pending as i32),
                jobs::scheduled_at.eq(next_scheduled_at),
                jobs::retry_count.eq(jobs::retry_count + 1),
                jobs::started_at.eq(None::<i64>),
                jobs::completed_at.eq(None::<i64>),
                jobs::error.eq(None::<String>),
            ))
            .execute(&mut conn)?;

        if affected == 0 {
            return Err(QueueError::JobNotFound(id.to_string()));
        }
        Ok(())
    }

    /// Cancel a pending job and cascade-cancel its dependents.
    pub fn cancel_job(&self, id: &str) -> Result<bool> {
        let now = now_millis();
        let mut conn = self.conn()?;

        let affected = diesel::update(jobs::table)
            .filter(jobs::id.eq(id))
            .filter(jobs::status.eq(JobStatus::Pending as i32))
            .set((
                jobs::status.eq(JobStatus::Cancelled as i32),
                jobs::completed_at.eq(now),
            ))
            .execute(&mut conn)?;

        drop(conn);
        if affected > 0 {
            self.cascade_cancel(id, "dependency cancelled")?;
        }

        Ok(affected > 0)
    }

    /// Request cancellation of a running job. The task must check for this.
    pub fn request_cancel(&self, id: &str) -> Result<bool> {
        let mut conn = self.conn()?;

        let affected = diesel::update(jobs::table)
            .filter(jobs::id.eq(id))
            .filter(jobs::status.eq(JobStatus::Running as i32))
            .set(jobs::cancel_requested.eq(1))
            .execute(&mut conn)?;

        Ok(affected > 0)
    }

    /// Check if cancellation has been requested for a job.
    pub fn is_cancel_requested(&self, id: &str) -> Result<bool> {
        let mut conn = self.conn()?;

        let val: Option<i32> = jobs::table
            .find(id)
            .select(jobs::cancel_requested)
            .first(&mut conn)
            .optional()?;

        Ok(val.unwrap_or(0) != 0)
    }

    /// Mark a job as cancelled (used when a running job detects cancellation).
    pub fn mark_cancelled(&self, id: &str) -> Result<()> {
        let now = now_millis();
        let mut conn = self.conn()?;

        diesel::update(jobs::table)
            .filter(jobs::id.eq(id))
            .set((
                jobs::status.eq(JobStatus::Cancelled as i32),
                jobs::completed_at.eq(now),
                jobs::error.eq("cancelled by request"),
            ))
            .execute(&mut conn)?;

        Ok(())
    }

    /// Cascade-cancel all pending jobs that depend (directly or transitively)
    /// on the given job. Uses BFS to handle deep chains.
    pub fn cascade_cancel(&self, failed_job_id: &str, reason: &str) -> Result<()> {
        let mut conn = self.conn()?;
        let now = now_millis();

        let mut queue: Vec<String> = vec![failed_job_id.to_string()];
        let mut visited = std::collections::HashSet::new();
        visited.insert(failed_job_id.to_string());
        let mut idx = 0;

        while idx < queue.len() {
            let current_id = queue[idx].clone();
            idx += 1;

            let dependents: Vec<String> = job_dependencies::table
                .filter(job_dependencies::depends_on_job_id.eq(&current_id))
                .select(job_dependencies::job_id)
                .load(&mut conn)?;

            for dep_id in dependents {
                if visited.insert(dep_id.clone()) {
                    queue.push(dep_id);
                }
            }
        }

        // Remove the original job from the list (only cancel dependents)
        if !queue.is_empty() {
            queue.remove(0);
        }

        if !queue.is_empty() {
            let error_msg = format!("{reason}: {failed_job_id}");
            diesel::update(jobs::table)
                .filter(jobs::id.eq_any(&queue))
                .filter(jobs::status.eq(JobStatus::Pending as i32))
                .set((
                    jobs::status.eq(JobStatus::Cancelled as i32),
                    jobs::completed_at.eq(now),
                    jobs::error.eq(&error_msg),
                ))
                .execute(&mut conn)?;
        }

        Ok(())
    }

    /// Get the IDs of jobs that a given job depends on.
    pub fn get_dependencies(&self, job_id: &str) -> Result<Vec<String>> {
        let mut conn = self.conn()?;
        let ids: Vec<String> = job_dependencies::table
            .filter(job_dependencies::job_id.eq(job_id))
            .select(job_dependencies::depends_on_job_id)
            .load(&mut conn)?;
        Ok(ids)
    }

    /// Get the IDs of jobs that depend on a given job.
    pub fn get_dependents(&self, job_id: &str) -> Result<Vec<String>> {
        let mut conn = self.conn()?;
        let ids: Vec<String> = job_dependencies::table
            .filter(job_dependencies::depends_on_job_id.eq(job_id))
            .select(job_dependencies::job_id)
            .load(&mut conn)?;
        Ok(ids)
    }

    /// Update progress for a running job (0-100).
    pub fn update_progress(&self, id: &str, progress: i32) -> Result<()> {
        let mut conn = self.conn()?;

        let affected = diesel::update(jobs::table)
            .filter(jobs::id.eq(id))
            .set(jobs::progress.eq(progress))
            .execute(&mut conn)?;

        if affected == 0 {
            return Err(QueueError::JobNotFound(id.to_string()));
        }
        Ok(())
    }

    /// List jobs with optional filters and pagination.
    pub fn list_jobs(
        &self,
        status: Option<i32>,
        queue_name: Option<&str>,
        task_name: Option<&str>,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<Job>> {
        let mut conn = self.conn()?;

        let mut query = jobs::table.into_boxed().order(jobs::created_at.desc());

        if let Some(s) = status {
            query = query.filter(jobs::status.eq(s));
        }
        if let Some(q) = queue_name {
            query = query.filter(jobs::queue.eq(q));
        }
        if let Some(t) = task_name {
            query = query.filter(jobs::task_name.eq(t));
        }

        let rows: Vec<JobRow> = query
            .limit(limit)
            .offset(offset)
            .select(JobRow::as_select())
            .load(&mut conn)?;

        Ok(rows.into_iter().map(Job::from).collect())
    }

    /// Get a job by ID.
    pub fn get_job(&self, id: &str) -> Result<Option<Job>> {
        let mut conn = self.conn()?;

        let row: Option<JobRow> = jobs::table
            .find(id)
            .select(JobRow::as_select())
            .first(&mut conn)
            .optional()?;

        Ok(row.map(Job::from))
    }

    /// Get queue statistics.
    pub fn stats(&self) -> Result<QueueStats> {
        let mut conn = self.conn()?;

        let rows: Vec<(i32, i64)> = jobs::table
            .group_by(jobs::status)
            .select((jobs::status, diesel::dsl::count(jobs::id)))
            .load(&mut conn)?;

        let mut stats = QueueStats::default();
        for (status, count) in rows {
            match JobStatus::from_i32(status) {
                Some(JobStatus::Pending) => stats.pending = count,
                Some(JobStatus::Running) => stats.running = count,
                Some(JobStatus::Complete) => stats.completed = count,
                Some(JobStatus::Failed) => stats.failed = count,
                Some(JobStatus::Dead) => stats.dead = count,
                Some(JobStatus::Cancelled) => stats.cancelled = count,
                None => {}
            }
        }

        Ok(stats)
    }

    /// Purge completed jobs older than the given timestamp.
    pub fn purge_completed(&self, older_than_ms: i64) -> Result<u64> {
        let mut conn = self.conn()?;

        let job_ids: Vec<String> = jobs::table
            .filter(jobs::status.eq(JobStatus::Complete as i32))
            .filter(jobs::completed_at.lt(older_than_ms))
            .select(jobs::id)
            .load(&mut conn)?;

        delete_job_children(&mut conn, &job_ids)?;

        let affected =
            diesel::delete(jobs::table.filter(jobs::id.eq_any(&job_ids))).execute(&mut conn)?;

        Ok(affected as u64)
    }

    /// Purge completed jobs respecting per-job result_ttl_ms.
    /// Jobs with their own result_ttl_ms use that; others use the given global cutoff.
    pub fn purge_completed_with_ttl(&self, global_cutoff_ms: i64) -> Result<u64> {
        let now = now_millis();
        let mut conn = self.conn()?;

        conn.transaction(|conn| {
            // For global TTL: collect IDs of completed jobs without per-job TTL
            let global_ids: Vec<String> = jobs::table
                .filter(jobs::status.eq(JobStatus::Complete as i32))
                .filter(jobs::result_ttl_ms.is_null())
                .filter(jobs::completed_at.lt(global_cutoff_ms))
                .select(jobs::id)
                .load(conn)?;

            // For per-job TTL: fetch candidates and collect expired IDs
            let rows_with_ttl: Vec<JobRow> = jobs::table
                .filter(jobs::status.eq(JobStatus::Complete as i32))
                .filter(jobs::result_ttl_ms.is_not_null())
                .select(JobRow::as_select())
                .load(conn)?;

            let per_job_ids: Vec<String> = rows_with_ttl
                .into_iter()
                .filter(|row| {
                    matches!(
                        (row.completed_at, row.result_ttl_ms),
                        (Some(completed), Some(ttl))
                            if completed.checked_add(ttl).is_some_and(|expiry| expiry < now)
                    )
                })
                .map(|row| row.id)
                .collect();

            let all_ids: Vec<String> = global_ids.into_iter().chain(per_job_ids).collect();

            delete_job_children(conn, &all_ids)?;

            let affected =
                diesel::delete(jobs::table.filter(jobs::id.eq_any(&all_ids))).execute(conn)?;

            Ok(affected as u64)
        })
    }

    /// Find stale running jobs that exceeded their timeout.
    pub fn reap_stale_jobs(&self, now: i64) -> Result<Vec<Job>> {
        let mut conn = self.conn()?;

        let rows: Vec<JobRow> = jobs::table
            .filter(jobs::status.eq(JobStatus::Running as i32))
            .filter(jobs::started_at.is_not_null())
            .select(JobRow::as_select())
            .load(&mut conn)?;

        let stale: Vec<Job> = rows
            .into_iter()
            .filter(|r| {
                if let Some(started) = r.started_at {
                    (started + r.timeout_ms) < now
                } else {
                    false
                }
            })
            .map(Job::from)
            .collect();

        Ok(stale)
    }

    /// Record an error for a job attempt.
    pub fn record_error(&self, job_id: &str, attempt: i32, error: &str) -> Result<()> {
        let mut conn = self.conn()?;
        let id = uuid::Uuid::now_v7().to_string();
        let now = now_millis();

        let row = NewJobErrorRow {
            id: &id,
            job_id,
            attempt,
            error,
            failed_at: now,
        };

        diesel::insert_into(super::super::schema::job_errors::table)
            .values(&row)
            .execute(&mut conn)?;

        Ok(())
    }

    /// Get all errors for a job, ordered by attempt.
    pub fn get_job_errors(&self, job_id: &str) -> Result<Vec<JobErrorRow>> {
        use super::super::schema::job_errors;
        let mut conn = self.conn()?;

        let rows = job_errors::table
            .filter(job_errors::job_id.eq(job_id))
            .order(job_errors::attempt.asc())
            .select(JobErrorRow::as_select())
            .load(&mut conn)?;

        Ok(rows)
    }

    /// Expire pending jobs that have passed their expires_at.
    pub fn expire_pending_jobs(&self, now: i64) -> Result<u64> {
        let mut conn = self.conn()?;

        let affected = diesel::update(jobs::table)
            .filter(jobs::status.eq(JobStatus::Pending as i32))
            .filter(jobs::expires_at.is_not_null())
            .filter(jobs::expires_at.lt(now))
            .set((
                jobs::status.eq(JobStatus::Cancelled as i32),
                jobs::completed_at.eq(now),
                jobs::error.eq("expired"),
            ))
            .execute(&mut conn)?;

        Ok(affected as u64)
    }

    /// Cancel all pending jobs in a specific queue.
    pub fn cancel_pending_by_queue(&self, queue: &str) -> Result<u64> {
        let mut conn = self.conn()?;
        let now = now_millis();

        let affected = diesel::update(jobs::table)
            .filter(jobs::status.eq(JobStatus::Pending as i32))
            .filter(jobs::queue.eq(queue))
            .set((
                jobs::status.eq(JobStatus::Cancelled as i32),
                jobs::completed_at.eq(now),
                jobs::error.eq("purged"),
            ))
            .execute(&mut conn)?;

        Ok(affected as u64)
    }

    /// Cancel all pending jobs for a specific task name.
    pub fn cancel_pending_by_task(&self, task_name: &str) -> Result<u64> {
        let mut conn = self.conn()?;
        let now = now_millis();

        let affected = diesel::update(jobs::table)
            .filter(jobs::status.eq(JobStatus::Pending as i32))
            .filter(jobs::task_name.eq(task_name))
            .set((
                jobs::status.eq(JobStatus::Cancelled as i32),
                jobs::completed_at.eq(now),
                jobs::error.eq("revoked"),
            ))
            .execute(&mut conn)?;

        Ok(affected as u64)
    }

    /// Purge job errors older than the given timestamp.
    pub fn purge_job_errors(&self, older_than_ms: i64) -> Result<u64> {
        use super::super::schema::job_errors;
        let mut conn = self.conn()?;

        let affected =
            diesel::delete(job_errors::table.filter(job_errors::failed_at.lt(older_than_ms)))
                .execute(&mut conn)?;

        Ok(affected as u64)
    }
}
