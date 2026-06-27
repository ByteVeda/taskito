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
                let job_id = job.id.clone();

                // Write-priority transaction: this reads the job row then writes
                // it to `archived_jobs`, which would deadlock under SQLite's
                // deferred lock-upgrade. See `write_transaction`.
                let dlq_retry_count = job
                    .metadata
                    .as_deref()
                    .and_then(|m| serde_json::from_str::<serde_json::Value>(m).ok())
                    .and_then(|v| v.get("__dlq_retry_count")?.as_i64())
                    .unwrap_or(0) as i32;

                self.write_transaction(|conn| {
                    let dlq_row = NewDeadLetterRow {
                        id: &dlq_id,
                        original_job_id: &job.id,
                        queue: &job.queue,
                        task_name: &job.task_name,
                        payload: &job.payload,
                        error: Some(error),
                        retry_count: job.retry_count,
                        failed_at: now,
                        // Preserve the job's own metadata so it survives the
                        // round trip; an explicit `metadata` arg overrides it.
                        metadata: metadata.or(job.metadata.as_deref()),
                        notes: job.notes.as_deref(),
                        priority: job.priority,
                        max_retries: job.max_retries,
                        timeout_ms: job.timeout_ms,
                        result_ttl_ms: job.result_ttl_ms,
                        namespace: job.namespace.as_deref(),
                        dlq_retry_count,
                    };

                    diesel::insert_into(dead_letter::table)
                        .values(&dlq_row)
                        .execute(conn)?;

                    // Archive the now-Dead job: move it out of the live `jobs`
                    // table into `archived_jobs` so the dequeue index and stats
                    // scans no longer see it. The row may already be absent if a
                    // prior terminal transition archived it; only archive when
                    // it is still live.
                    if let Some(mut row) = jobs::table
                        .find(&job.id)
                        .select(JobRow::as_select())
                        .first(conn)
                        .optional()?
                    {
                        row.status = JobStatus::Dead as i32;
                        row.error = Some(error.to_string());
                        row.completed_at = Some(now);
                        <$storage_type>::archive_job_row(conn, &row)?;
                    }

                    Ok::<(), QueueError>(())
                })?;

                // Cascade cancel dependents (opens its own connection, so the
                // archive transaction above must already be committed).
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

            /// List dead letter entries for a single task, newest first.
            pub fn list_dead_by_task(
                &self,
                task_name: &str,
                limit: i64,
                offset: i64,
            ) -> Result<Vec<DeadJob>> {
                let mut conn = self.conn()?;

                let rows: Vec<DeadLetterRow> = dead_letter::table
                    .filter(dead_letter::task_name.eq(task_name))
                    .order(dead_letter::failed_at.desc())
                    .limit(limit)
                    .offset(offset)
                    .select(DeadLetterRow::as_select())
                    .load(&mut conn)?;

                Ok(rows.into_iter().map(DeadJob::from).collect())
            }

            /// Delete every dead letter entry for a task. Returns the count removed.
            pub fn purge_dead_by_task(&self, task_name: &str) -> Result<u64> {
                let mut conn = self.conn()?;

                let affected =
                    diesel::delete(dead_letter::table.filter(dead_letter::task_name.eq(task_name)))
                        .execute(&mut conn)?;

                Ok(affected as u64)
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

                let retry_metadata = {
                    let next_count = dead_row.dlq_retry_count + 1;
                    let mut obj = dead_row
                        .metadata
                        .as_deref()
                        .and_then(|m| {
                            serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(m)
                                .ok()
                        })
                        .unwrap_or_default();
                    obj.insert(
                        "__dlq_retry_count".to_string(),
                        serde_json::Value::from(next_count),
                    );
                    Some(serde_json::to_string(&serde_json::Value::Object(obj)).unwrap_or_default())
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
                    metadata: retry_metadata,
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

                    // Dual-write the payload to the 1:1 side table so the
                    // re-enqueued job is readable through the narrow dequeue /
                    // get_job join path.
                    diesel::insert_into(super::super::schema::job_payloads::table)
                        .values(&super::super::models::NewJobPayloadRow {
                            job_id: &job.id,
                            payload: &job.payload,
                            result: None,
                        })
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

            /// Delete a single dead letter entry. Returns true if it existed.
            pub fn delete_dead(&self, dead_id: &str) -> Result<bool> {
                let mut conn = self.conn()?;
                let affected =
                    diesel::delete(dead_letter::table.find(dead_id)).execute(&mut conn)?;
                Ok(affected > 0)
            }

            /// Purge dead letter entries respecting per-entry TTL overrides.
            pub fn purge_dead_with_ttl(&self, global_cutoff_ms: i64) -> Result<u64> {
                let now = now_millis();
                let mut conn = self.conn()?;

                let global_count = diesel::delete(
                    dead_letter::table
                        .filter(dead_letter::result_ttl_ms.is_null())
                        .filter(dead_letter::failed_at.lt(global_cutoff_ms)),
                )
                .execute(&mut conn)?;

                let per_entry_count = diesel::delete(
                    dead_letter::table
                        .filter(dead_letter::result_ttl_ms.is_not_null())
                        .filter(
                            (dead_letter::failed_at + dead_letter::result_ttl_ms.assume_not_null())
                                .lt(now),
                        ),
                )
                .execute(&mut conn)?;

                Ok((global_count + per_entry_count) as u64)
            }

            /// List DLQ entries eligible for auto-retry.
            pub fn list_dead_for_retry(
                &self,
                cutoff_ms: i64,
                max_retries: i32,
                namespace: Option<&str>,
                queues: &[String],
                limit: i64,
            ) -> Result<Vec<DeadJob>> {
                let mut conn = self.conn()?;

                // Scope to the worker's own namespace + served queues, mirroring
                // the poller's dequeue scoping, so auto-retry never resurrects
                // entries belonging to other namespaces/queues.
                let mut query = dead_letter::table
                    .filter(dead_letter::failed_at.le(cutoff_ms))
                    .filter(dead_letter::dlq_retry_count.lt(max_retries))
                    .filter(dead_letter::queue.eq_any(queues))
                    .into_boxed();
                match namespace {
                    Some(ns) => query = query.filter(dead_letter::namespace.eq(ns)),
                    None => query = query.filter(dead_letter::namespace.is_null()),
                }

                let rows: Vec<DeadLetterRow> = query
                    .order(dead_letter::failed_at.asc())
                    .limit(limit)
                    .select(DeadLetterRow::as_select())
                    .load(&mut conn)?;

                Ok(rows.into_iter().map(DeadJob::from).collect())
            }
        }
    };
}

pub(crate) use impl_diesel_dead_letter_ops;
