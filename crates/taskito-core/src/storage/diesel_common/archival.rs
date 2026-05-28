/// Generates the shared `list_archived` method for Diesel-backed storage backends.
///
/// `archive_old_jobs` differs between SQLite (`INSERT OR IGNORE`) and Postgres
/// (`ON CONFLICT DO NOTHING` + `$1` bind syntax), so it remains backend-specific.
macro_rules! impl_diesel_archival_ops {
    ($storage_type:ty) => {
        impl $storage_type {
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
                        notes: row.notes,
                        cancel_requested: row.cancel_requested != 0,
                        expires_at: row.expires_at,
                        result_ttl_ms: row.result_ttl_ms,
                        namespace: row.namespace,
                    })
                    .collect())
            }
        }
    };
}

pub(crate) use impl_diesel_archival_ops;
