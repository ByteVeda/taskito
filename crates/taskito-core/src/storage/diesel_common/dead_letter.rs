/// Generates shared dead-letter operation methods for Diesel-backed storage backends.
///
/// All four methods (`move_to_dlq`, `list_dead`, `retry_dead`, `purge_dead`) are
/// identical between SQLite and Postgres, so the entire file is macro-generated.
macro_rules! impl_diesel_dead_letter_ops {
    ($storage_type:ty) => {
        impl $storage_type {
            /// Move a job to the dead letter queue and cascade-cancel dependents.
            pub fn move_to_dlq(
                &self,
                job: &Job,
                error: &str,
                metadata: Option<&str>,
            ) -> Result<()> {
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
                        notes: job.notes.as_deref(),
                        priority: job.priority,
                        max_retries: job.max_retries,
                        timeout_ms: job.timeout_ms,
                        result_ttl_ms: job.result_ttl_ms,
                        namespace: job.namespace.as_deref(),
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

                // Drop connection before cascade (needed for single-connection pools).
                drop(conn);

                // Cascade cancel dependents.
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
            ///
            /// Returns `JobNotFound` only when the dead-letter row is absent or
            /// is removed concurrently by another retry; other Diesel errors
            /// propagate as `Storage` so real DB failures aren't masked. The
            /// delete inside the transaction asserts a row was actually removed,
            /// preventing two concurrent retries from both committing a fresh
            /// enqueue against the same dead-letter id.
            pub fn retry_dead(&self, dead_id: &str) -> Result<String> {
                let mut conn = self.conn()?;

                let dead_row: DeadLetterRow = match dead_letter::table
                    .find(dead_id)
                    .select(DeadLetterRow::as_select())
                    .first(&mut conn)
                {
                    Ok(row) => row,
                    Err(diesel::result::Error::NotFound) => {
                        return Err(QueueError::JobNotFound(dead_id.to_string()));
                    }
                    Err(err) => return Err(err.into()),
                };

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
                    notes: dead_row.notes,
                    depends_on: vec![],
                    expires_at: None,
                    result_ttl_ms: dead_row.result_ttl_ms,
                    namespace: dead_row.namespace,
                };

                let job = new_job.into_job();

                let result = conn.transaction(|conn| {
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
                        notes: job.notes.as_deref(),
                        cancel_requested: 0,
                        expires_at: job.expires_at,
                        result_ttl_ms: job.result_ttl_ms,
                        namespace: job.namespace.as_deref(),
                        has_deps: job.has_deps,
                    };

                    diesel::insert_into(jobs::table)
                        .values(&row)
                        .execute(conn)?;

                    let deleted = diesel::delete(dead_letter::table.find(dead_id)).execute(conn)?;
                    if deleted == 0 {
                        // A concurrent retry won the race. Roll back the
                        // freshly-inserted job by returning an error from the
                        // transaction closure — Diesel aborts the txn.
                        return Err(diesel::result::Error::NotFound);
                    }

                    Ok::<(), diesel::result::Error>(())
                });

                match result {
                    Ok(()) => Ok(job.id),
                    Err(diesel::result::Error::NotFound) => {
                        Err(QueueError::JobNotFound(dead_id.to_string()))
                    }
                    Err(err) => Err(err.into()),
                }
            }

            /// Purge dead letter entries older than the given timestamp.
            pub fn purge_dead(&self, older_than_ms: i64) -> Result<u64> {
                let mut conn = self.conn()?;

                let affected = diesel::delete(
                    dead_letter::table.filter(dead_letter::failed_at.lt(older_than_ms)),
                )
                .execute(&mut conn)?;

                Ok(affected as u64)
            }
        }
    };
}

pub(crate) use impl_diesel_dead_letter_ops;
