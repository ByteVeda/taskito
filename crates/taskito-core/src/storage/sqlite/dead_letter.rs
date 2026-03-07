use diesel::prelude::*;

use crate::error::{QueueError, Result};
use crate::job::{NewJob, now_millis, Job, JobStatus};
use super::super::models::*;
use super::super::schema::{dead_letter, jobs};
use crate::storage::DeadJob;
use super::SqliteStorage;

impl SqliteStorage {
    /// Move a job to the dead letter queue and cascade-cancel dependents.
    pub fn move_to_dlq(&self, job: &Job, error: &str, metadata: Option<&str>) -> Result<()> {
        let now = now_millis();
        let dlq_id = uuid::Uuid::now_v7().to_string();
        let mut conn = self.conn()?;
        let job_id = job.id.clone();

        conn.transaction(|conn| {
            let dlq_row = NewDeadLetterRow {
                id: &dlq_id,
                original_job_id: &job.id,
                queue: &job.queue,
                task_name: &job.task_name,
                payload: &job.payload,
                error: Some(error),
                retry_count: job.retry_count,
                failed_at: now,
                metadata,
                priority: job.priority,
                max_retries: job.max_retries,
                timeout_ms: job.timeout_ms,
                result_ttl_ms: job.result_ttl_ms,
            };

            diesel::insert_into(dead_letter::table)
                .values(&dlq_row)
                .execute(conn)?;

            diesel::update(jobs::table)
                .filter(jobs::id.eq(&job.id))
                .set((
                    jobs::status.eq(JobStatus::Dead as i32),
                    jobs::error.eq(error),
                    jobs::completed_at.eq(now),
                ))
                .execute(conn)?;

            Ok::<(), diesel::result::Error>(())
        })?;

        // Drop connection before cascade (needed for single-connection pools)
        drop(conn);

        // Cascade cancel dependents
        self.cascade_cancel(&job_id, "dependency failed")?;

        Ok(())
    }

    /// List dead letter entries.
    pub fn list_dead(&self, limit: i64, offset: i64) -> Result<Vec<DeadJob>> {
        let mut conn = self.conn()?;

        let rows: Vec<DeadLetterRow> = dead_letter::table
            .order(dead_letter::failed_at.desc())
            .limit(limit)
            .offset(offset)
            .select(DeadLetterRow::as_select())
            .load(&mut conn)?;

        Ok(rows.into_iter().map(DeadJob::from).collect())
    }

    /// Re-enqueue a dead letter job. Returns the new job ID.
    pub fn retry_dead(&self, dead_id: &str) -> Result<String> {
        let mut conn = self.conn()?;

        let dead_row: DeadLetterRow = dead_letter::table
            .find(dead_id)
            .select(DeadLetterRow::as_select())
            .first(&mut conn)
            .map_err(|_| QueueError::JobNotFound(dead_id.to_string()))?;

        let new_job = NewJob {
            queue: dead_row.queue,
            task_name: dead_row.task_name,
            payload: dead_row.payload,
            priority: dead_row.priority,
            scheduled_at: now_millis(),
            max_retries: dead_row.max_retries,
            timeout_ms: dead_row.timeout_ms,
            unique_key: None,
            metadata: dead_row.metadata,
            depends_on: vec![],
            expires_at: None,
            result_ttl_ms: dead_row.result_ttl_ms,
        };

        let job = new_job.into_job();

        conn.transaction(|conn| {
            let row = super::super::models::NewJobRow {
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
            };

            diesel::insert_into(jobs::table)
                .values(&row)
                .execute(conn)?;

            diesel::delete(dead_letter::table.find(dead_id))
                .execute(conn)?;

            Ok::<(), diesel::result::Error>(())
        })?;

        Ok(job.id)
    }

    /// Purge dead letter entries older than the given timestamp.
    pub fn purge_dead(&self, older_than_ms: i64) -> Result<u64> {
        let mut conn = self.conn()?;

        let affected = diesel::delete(
            dead_letter::table.filter(dead_letter::failed_at.lt(older_than_ms))
        ).execute(&mut conn)?;

        Ok(affected as u64)
    }
}
