use diesel::prelude::*;

use super::super::models::ArchivedJobRow;
use super::super::schema::archived_jobs;
use super::SqliteStorage;
use crate::error::Result;
use crate::job::{Job, JobStatus};

impl SqliteStorage {
    /// Archive completed/dead/cancelled jobs older than cutoff_ms.
    /// Moves them from `jobs` to `archived_jobs`.
    pub fn archive_old_jobs(&self, cutoff_ms: i64) -> Result<u64> {
        let mut conn = self.conn()?;

        conn.transaction(|conn| {
            // Use raw SQL for INSERT INTO ... SELECT across tables
            let affected = diesel::sql_query(
                "INSERT OR IGNORE INTO archived_jobs SELECT * FROM jobs \
                 WHERE status IN (2, 4, 5) AND completed_at IS NOT NULL AND completed_at < ?1",
            )
            .bind::<diesel::sql_types::BigInt, _>(cutoff_ms)
            .execute(conn)?;

            diesel::sql_query(
                "DELETE FROM jobs WHERE status IN (2, 4, 5) AND completed_at IS NOT NULL AND completed_at < ?1",
            )
            .bind::<diesel::sql_types::BigInt, _>(cutoff_ms)
            .execute(conn)?;

            Ok(affected as u64)
        })
    }

    /// List archived jobs with pagination.
    pub fn list_archived(&self, limit: i64, offset: i64) -> Result<Vec<Job>> {
        let mut conn = self.conn()?;

        let rows: Vec<ArchivedJobRow> = archived_jobs::table
            .order(archived_jobs::completed_at.desc())
            .limit(limit)
            .offset(offset)
            .select(ArchivedJobRow::as_select())
            .load(&mut conn)?;

        Ok(rows
            .into_iter()
            .map(|row| Job {
                id: row.id,
                queue: row.queue,
                task_name: row.task_name,
                payload: row.payload,
                status: JobStatus::from_i32(row.status).unwrap_or(JobStatus::Pending),
                priority: row.priority,
                created_at: row.created_at,
                scheduled_at: row.scheduled_at,
                started_at: row.started_at,
                completed_at: row.completed_at,
                retry_count: row.retry_count,
                max_retries: row.max_retries,
                result: row.result,
                error: row.error,
                timeout_ms: row.timeout_ms,
                unique_key: row.unique_key,
                progress: row.progress,
                metadata: row.metadata,
                cancel_requested: row.cancel_requested != 0,
                expires_at: row.expires_at,
                result_ttl_ms: row.result_ttl_ms,
                namespace: None,
            })
            .collect())
    }
}
