use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};
use diesel::sqlite::SqliteConnection;

use crate::error::{QueueError, Result};
use crate::job::{Job, JobStatus, NewJob, now_millis};
use super::models::*;
use super::schema::{dead_letter, job_dependencies, job_errors, jobs, periodic_tasks, rate_limits};

type DbPool = Pool<ConnectionManager<SqliteConnection>>;

/// SQLite-backed storage for the task queue, using Diesel ORM.
#[derive(Clone)]
pub struct SqliteStorage {
    pool: DbPool,
}

impl SqliteStorage {
    /// Open (or create) a SQLite database at the given path.
    pub fn new(db_path: &str) -> Result<Self> {
        let manager = ConnectionManager::<SqliteConnection>::new(db_path);
        let pool = Pool::builder()
            .max_size(8)
            .build(manager)?;

        let storage = Self { pool };
        storage.run_pragmas()?;
        storage.run_migrations()?;
        Ok(storage)
    }

    /// Create an in-memory storage (useful for tests).
    pub fn in_memory() -> Result<Self> {
        let manager = ConnectionManager::<SqliteConnection>::new(":memory:");
        let pool = Pool::builder()
            .max_size(1)
            .build(manager)?;

        let storage = Self { pool };
        storage.run_pragmas()?;
        storage.run_migrations()?;
        Ok(storage)
    }

    fn conn(&self) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>> {
        Ok(self.pool.get()?)
    }

    fn run_pragmas(&self) -> Result<()> {
        let mut conn = self.conn()?;
        diesel::sql_query("PRAGMA journal_mode = WAL").execute(&mut conn)?;
        diesel::sql_query("PRAGMA busy_timeout = 5000").execute(&mut conn)?;
        diesel::sql_query("PRAGMA journal_size_limit = 67108864").execute(&mut conn)?;
        diesel::sql_query("PRAGMA synchronous = NORMAL").execute(&mut conn)?;
        Ok(())
    }

    fn run_migrations(&self) -> Result<()> {
        let mut conn = self.conn()?;

        diesel::sql_query(
            "CREATE TABLE IF NOT EXISTS jobs (
                id           TEXT PRIMARY KEY,
                queue        TEXT NOT NULL DEFAULT 'default',
                task_name    TEXT NOT NULL,
                payload      BLOB NOT NULL,
                status       INTEGER NOT NULL DEFAULT 0,
                priority     INTEGER NOT NULL DEFAULT 0,
                created_at   INTEGER NOT NULL,
                scheduled_at INTEGER NOT NULL,
                started_at   INTEGER,
                completed_at INTEGER,
                retry_count  INTEGER NOT NULL DEFAULT 0,
                max_retries  INTEGER NOT NULL DEFAULT 3,
                result       BLOB,
                error        TEXT,
                timeout_ms   INTEGER NOT NULL DEFAULT 300000,
                unique_key   TEXT,
                progress     INTEGER,
                metadata     TEXT
            )"
        ).execute(&mut conn)?;

        diesel::sql_query(
            "CREATE INDEX IF NOT EXISTS idx_jobs_dequeue
                ON jobs(queue, status, priority DESC, scheduled_at)"
        ).execute(&mut conn)?;

        diesel::sql_query(
            "CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)"
        ).execute(&mut conn)?;

        diesel::sql_query(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_unique_key
                ON jobs(unique_key) WHERE unique_key IS NOT NULL AND status IN (0, 1)"
        ).execute(&mut conn)?;

        diesel::sql_query(
            "CREATE TABLE IF NOT EXISTS dead_letter (
                id              TEXT PRIMARY KEY,
                original_job_id TEXT NOT NULL,
                queue           TEXT NOT NULL,
                task_name       TEXT NOT NULL,
                payload         BLOB NOT NULL,
                error           TEXT,
                retry_count     INTEGER NOT NULL,
                failed_at       INTEGER NOT NULL,
                metadata        TEXT
            )"
        ).execute(&mut conn)?;

        diesel::sql_query(
            "CREATE TABLE IF NOT EXISTS rate_limits (
                key         TEXT PRIMARY KEY,
                tokens      REAL NOT NULL,
                max_tokens  REAL NOT NULL,
                refill_rate REAL NOT NULL,
                last_refill INTEGER NOT NULL
            )"
        ).execute(&mut conn)?;

        diesel::sql_query(
            "CREATE TABLE IF NOT EXISTS periodic_tasks (
                name        TEXT PRIMARY KEY,
                task_name   TEXT NOT NULL,
                cron_expr   TEXT NOT NULL,
                args        BLOB,
                kwargs      BLOB,
                queue       TEXT NOT NULL DEFAULT 'default',
                enabled     INTEGER NOT NULL DEFAULT 1,
                last_run    INTEGER,
                next_run    INTEGER NOT NULL
            )"
        ).execute(&mut conn)?;

        diesel::sql_query(
            "CREATE TABLE IF NOT EXISTS job_errors (
                id        TEXT PRIMARY KEY,
                job_id    TEXT NOT NULL,
                attempt   INTEGER NOT NULL,
                error     TEXT NOT NULL,
                failed_at INTEGER NOT NULL
            )"
        ).execute(&mut conn)?;

        diesel::sql_query(
            "CREATE INDEX IF NOT EXISTS idx_job_errors_job_id ON job_errors(job_id)"
        ).execute(&mut conn)?;

        diesel::sql_query(
            "CREATE TABLE IF NOT EXISTS job_dependencies (
                id                TEXT PRIMARY KEY,
                job_id            TEXT NOT NULL,
                depends_on_job_id TEXT NOT NULL
            )"
        ).execute(&mut conn)?;

        diesel::sql_query(
            "CREATE INDEX IF NOT EXISTS idx_job_deps_job_id ON job_dependencies(job_id)"
        ).execute(&mut conn)?;

        diesel::sql_query(
            "CREATE INDEX IF NOT EXISTS idx_job_deps_depends_on ON job_dependencies(depends_on_job_id)"
        ).execute(&mut conn)?;

        Ok(())
    }

    // ── Job operations ─────────────────────────────────────────────────

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
                    Some(d) if d.status == JobStatus::Dead as i32
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
        }).map_err(|e| match e {
            diesel::result::Error::RollbackTransaction => {
                QueueError::DependencyNotFound("dependency not found or already dead/cancelled".to_string())
            }
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

        // Check for existing active job with same unique_key
        if let Some(ref uk) = job.unique_key {
            let existing: Option<JobRow> = jobs::table
                .filter(jobs::unique_key.eq(uk))
                .filter(jobs::status.eq_any([
                    JobStatus::Pending as i32,
                    JobStatus::Running as i32,
                ]))
                .select(JobRow::as_select())
                .first(&mut conn)
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
        };

        diesel::insert_into(jobs::table)
            .values(&row)
            .execute(&mut conn)?;

        // Insert dependency rows
        for dep_id in &depends_on {
            let dep_row = NewJobDependencyRow {
                id: &uuid::Uuid::now_v7().to_string(),
                job_id: &job.id,
                depends_on_job_id: dep_id,
            };
            diesel::insert_into(job_dependencies::table)
                .values(&dep_row)
                .execute(&mut conn)?;
        }

        Ok(job)
    }

    /// Check if all dependencies for a job are complete.
    fn deps_satisfied(conn: &mut SqliteConnection, job_id: &str) -> diesel::result::QueryResult<bool> {
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
    pub fn dequeue(&self, queue_name: &str, now: i64) -> Result<Option<Job>> {
        let mut conn = self.conn()?;

        conn.transaction(|conn| {
            // Find candidate jobs (check a few in case some have unmet deps)
            let candidates: Vec<JobRow> = jobs::table
                .filter(jobs::queue.eq(queue_name))
                .filter(jobs::status.eq(JobStatus::Pending as i32))
                .filter(jobs::scheduled_at.le(now))
                .order((jobs::priority.desc(), jobs::scheduled_at.asc()))
                .limit(10)
                .select(JobRow::as_select())
                .load(conn)?;

            for row in candidates {
                // Check if all dependencies are satisfied
                if !Self::deps_satisfied(conn, &row.id)? {
                    continue;
                }

                // Atomically claim it
                diesel::update(jobs::table)
                    .filter(jobs::id.eq(&row.id))
                    .filter(jobs::status.eq(JobStatus::Pending as i32))
                    .set((
                        jobs::status.eq(JobStatus::Running as i32),
                        jobs::started_at.eq(now),
                    ))
                    .execute(conn)?;

                // Re-read the updated row
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
    /// Returns true if cancelled, false if not pending.
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

    /// Cascade-cancel all pending jobs that depend (directly or transitively)
    /// on the given job. Uses BFS to handle deep chains.
    pub fn cascade_cancel(&self, failed_job_id: &str, reason: &str) -> Result<()> {
        let mut conn = self.conn()?;
        let now = now_millis();

        let mut queue: Vec<String> = vec![failed_job_id.to_string()];
        let mut idx = 0;

        while idx < queue.len() {
            let current_id = queue[idx].clone();
            idx += 1;

            let dependents: Vec<String> = job_dependencies::table
                .filter(job_dependencies::depends_on_job_id.eq(&current_id))
                .select(job_dependencies::job_id)
                .load(&mut conn)?;

            for dep_id in dependents {
                if !queue.contains(&dep_id) {
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

        let mut query = jobs::table
            .into_boxed()
            .order(jobs::created_at.desc());

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

    // ── Dead letter operations ─────────────────────────────────────────

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

        // Drop conn before calling enqueue (which gets its own conn)
        drop(conn);

        let new_job = NewJob {
            queue: dead_row.queue,
            task_name: dead_row.task_name,
            payload: dead_row.payload,
            priority: 0,
            scheduled_at: now_millis(),
            max_retries: 3,
            timeout_ms: 300_000,
            unique_key: None,
            metadata: None,
            depends_on: vec![],
        };

        let job = self.enqueue(new_job)?;

        let mut conn = self.conn()?;
        diesel::delete(dead_letter::table.find(dead_id))
            .execute(&mut conn)?;

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

    /// Purge completed jobs older than the given timestamp.
    pub fn purge_completed(&self, older_than_ms: i64) -> Result<u64> {
        let mut conn = self.conn()?;

        let affected = diesel::delete(
            jobs::table
                .filter(jobs::status.eq(JobStatus::Complete as i32))
                .filter(jobs::completed_at.lt(older_than_ms))
        ).execute(&mut conn)?;

        Ok(affected as u64)
    }

    /// Find stale running jobs that exceeded their timeout.
    pub fn reap_stale_jobs(&self, now: i64) -> Result<Vec<Job>> {
        let mut conn = self.conn()?;

        // SQLite doesn't support column arithmetic in Diesel DSL easily,
        // so we use sql_query for the timeout comparison.
        let rows: Vec<JobRow> = jobs::table
            .filter(jobs::status.eq(JobStatus::Running as i32))
            .filter(jobs::started_at.is_not_null())
            .select(JobRow::as_select())
            .load(&mut conn)?;

        // Filter in Rust for the timeout condition
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

    // ── Rate limit operations ──────────────────────────────────────────

    pub fn get_rate_limit(&self, key: &str) -> Result<Option<RateLimitRow>> {
        let mut conn = self.conn()?;

        let row: Option<RateLimitRow> = rate_limits::table
            .find(key)
            .select(RateLimitRow::as_select())
            .first(&mut conn)
            .optional()?;

        Ok(row)
    }

    pub fn upsert_rate_limit(&self, row: &RateLimitRow) -> Result<()> {
        let mut conn = self.conn()?;

        diesel::replace_into(rate_limits::table)
            .values(row)
            .execute(&mut conn)?;

        Ok(())
    }

    // ── Periodic task operations ───────────────────────────────────────

    /// Register or update a periodic task.
    pub fn register_periodic(&self, task: &NewPeriodicTaskRow) -> Result<()> {
        let mut conn = self.conn()?;

        diesel::replace_into(periodic_tasks::table)
            .values(task)
            .execute(&mut conn)?;

        Ok(())
    }

    /// Get all periodic tasks that are due to run.
    pub fn get_due_periodic(&self, now: i64) -> Result<Vec<PeriodicTaskRow>> {
        let mut conn = self.conn()?;

        let rows = periodic_tasks::table
            .filter(periodic_tasks::enabled.eq(true))
            .filter(periodic_tasks::next_run.le(now))
            .select(PeriodicTaskRow::as_select())
            .load(&mut conn)?;

        Ok(rows)
    }

    // ── Job error operations ──────────────────────────────────────────

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

        diesel::insert_into(job_errors::table)
            .values(&row)
            .execute(&mut conn)?;

        Ok(())
    }

    /// Get all errors for a job, ordered by attempt.
    pub fn get_job_errors(&self, job_id: &str) -> Result<Vec<JobErrorRow>> {
        let mut conn = self.conn()?;

        let rows = job_errors::table
            .filter(job_errors::job_id.eq(job_id))
            .order(job_errors::attempt.asc())
            .select(JobErrorRow::as_select())
            .load(&mut conn)?;

        Ok(rows)
    }

    /// Purge job errors older than the given timestamp.
    pub fn purge_job_errors(&self, older_than_ms: i64) -> Result<u64> {
        let mut conn = self.conn()?;

        let affected = diesel::delete(
            job_errors::table.filter(job_errors::failed_at.lt(older_than_ms))
        ).execute(&mut conn)?;

        Ok(affected as u64)
    }

    // ── Periodic task operations ───────────────────────────────────────

    /// Update a periodic task's schedule after execution.
    pub fn update_periodic_schedule(
        &self,
        name: &str,
        last_run: i64,
        next_run: i64,
    ) -> Result<()> {
        let mut conn = self.conn()?;

        diesel::update(periodic_tasks::table.find(name))
            .set((
                periodic_tasks::last_run.eq(last_run),
                periodic_tasks::next_run.eq(next_run),
            ))
            .execute(&mut conn)?;

        Ok(())
    }
}

// ── Helper types ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Default)]
pub struct QueueStats {
    pub pending: i64,
    pub running: i64,
    pub completed: i64,
    pub failed: i64,
    pub dead: i64,
    pub cancelled: i64,
}

#[derive(Debug, Clone)]
pub struct DeadJob {
    pub id: String,
    pub original_job_id: String,
    pub queue: String,
    pub task_name: String,
    pub payload: Vec<u8>,
    pub error: Option<String>,
    pub retry_count: i32,
    pub failed_at: i64,
    pub metadata: Option<String>,
}

impl From<DeadLetterRow> for DeadJob {
    fn from(row: DeadLetterRow) -> Self {
        Self {
            id: row.id,
            original_job_id: row.original_job_id,
            queue: row.queue,
            task_name: row.task_name,
            payload: row.payload,
            error: row.error,
            retry_count: row.retry_count,
            failed_at: row.failed_at,
            metadata: row.metadata,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_storage() -> SqliteStorage {
        SqliteStorage::in_memory().unwrap()
    }

    fn make_job(task_name: &str) -> NewJob {
        NewJob {
            queue: "default".to_string(),
            task_name: task_name.to_string(),
            payload: vec![1, 2, 3],
            priority: 0,
            scheduled_at: now_millis(),
            max_retries: 3,
            timeout_ms: 300_000,
            unique_key: None,
            metadata: None,
            depends_on: vec![],
        }
    }

    #[test]
    fn test_enqueue_and_get() {
        let storage = test_storage();
        let job = storage.enqueue(make_job("test_task")).unwrap();

        let fetched = storage.get_job(&job.id).unwrap().unwrap();
        assert_eq!(fetched.task_name, "test_task");
        assert_eq!(fetched.status, JobStatus::Pending);
    }

    #[test]
    fn test_dequeue() {
        let storage = test_storage();
        let job = storage.enqueue(make_job("dequeue_task")).unwrap();

        let dequeued = storage.dequeue("default", now_millis() + 1000).unwrap().unwrap();
        assert_eq!(dequeued.id, job.id);
        assert_eq!(dequeued.status, JobStatus::Running);

        // Should not dequeue again
        let none = storage.dequeue("default", now_millis() + 1000).unwrap();
        assert!(none.is_none());
    }

    #[test]
    fn test_dequeue_respects_schedule() {
        let storage = test_storage();
        let future = now_millis() + 60_000;
        let mut new_job = make_job("future_task");
        new_job.scheduled_at = future;
        storage.enqueue(new_job).unwrap();

        let none = storage.dequeue("default", now_millis()).unwrap();
        assert!(none.is_none());

        let some = storage.dequeue("default", future + 1).unwrap();
        assert!(some.is_some());
    }

    #[test]
    fn test_priority_ordering() {
        let storage = test_storage();

        let mut low = make_job("low_priority");
        low.priority = 1;
        storage.enqueue(low).unwrap();

        let mut high = make_job("high_priority");
        high.priority = 10;
        storage.enqueue(high).unwrap();

        let now = now_millis() + 1000;
        let first = storage.dequeue("default", now).unwrap().unwrap();
        assert_eq!(first.task_name, "high_priority");

        let second = storage.dequeue("default", now).unwrap().unwrap();
        assert_eq!(second.task_name, "low_priority");
    }

    #[test]
    fn test_complete() {
        let storage = test_storage();
        let job = storage.enqueue(make_job("complete_task")).unwrap();
        storage.dequeue("default", now_millis() + 1000).unwrap();

        storage.complete(&job.id, Some(vec![42])).unwrap();

        let fetched = storage.get_job(&job.id).unwrap().unwrap();
        assert_eq!(fetched.status, JobStatus::Complete);
        assert_eq!(fetched.result, Some(vec![42]));
    }

    #[test]
    fn test_fail_and_retry() {
        let storage = test_storage();
        let job = storage.enqueue(make_job("fail_task")).unwrap();
        storage.dequeue("default", now_millis() + 1000).unwrap();

        storage.fail(&job.id, "something broke").unwrap();
        let fetched = storage.get_job(&job.id).unwrap().unwrap();
        assert_eq!(fetched.status, JobStatus::Failed);
        assert_eq!(fetched.error.as_deref(), Some("something broke"));
    }

    #[test]
    fn test_retry_reschedule() {
        let storage = test_storage();
        let job = storage.enqueue(make_job("retry_task")).unwrap();
        storage.dequeue("default", now_millis() + 1000).unwrap();

        let future = now_millis() + 5000;
        storage.retry(&job.id, future).unwrap();

        let fetched = storage.get_job(&job.id).unwrap().unwrap();
        assert_eq!(fetched.status, JobStatus::Pending);
        assert_eq!(fetched.retry_count, 1);
        assert_eq!(fetched.scheduled_at, future);
    }

    #[test]
    fn test_dead_letter_queue() {
        let storage = test_storage();
        let job = storage.enqueue(make_job("dlq_task")).unwrap();
        storage.dequeue("default", now_millis() + 1000).unwrap();

        storage.move_to_dlq(&storage.get_job(&job.id).unwrap().unwrap(), "max retries exceeded", None).unwrap();

        let fetched = storage.get_job(&job.id).unwrap().unwrap();
        assert_eq!(fetched.status, JobStatus::Dead);

        let dead = storage.list_dead(10, 0).unwrap();
        assert_eq!(dead.len(), 1);
        assert_eq!(dead[0].original_job_id, job.id);
    }

    #[test]
    fn test_retry_dead() {
        let storage = test_storage();
        let job = storage.enqueue(make_job("retry_dead_task")).unwrap();
        storage.dequeue("default", now_millis() + 1000).unwrap();

        let running_job = storage.get_job(&job.id).unwrap().unwrap();
        storage.move_to_dlq(&running_job, "fatal error", None).unwrap();

        let dead = storage.list_dead(10, 0).unwrap();
        let new_id = storage.retry_dead(&dead[0].id).unwrap();

        let new_job = storage.get_job(&new_id).unwrap().unwrap();
        assert_eq!(new_job.status, JobStatus::Pending);
        assert_eq!(new_job.task_name, "retry_dead_task");

        let dead = storage.list_dead(10, 0).unwrap();
        assert!(dead.is_empty());
    }

    #[test]
    fn test_stats() {
        let storage = test_storage();
        storage.enqueue(make_job("t1")).unwrap();
        storage.enqueue(make_job("t2")).unwrap();

        let stats = storage.stats().unwrap();
        assert_eq!(stats.pending, 2);
        assert_eq!(stats.running, 0);
    }

    #[test]
    fn test_cancel_job() {
        let storage = test_storage();
        let job = storage.enqueue(make_job("cancel_me")).unwrap();

        assert!(storage.cancel_job(&job.id).unwrap());

        let fetched = storage.get_job(&job.id).unwrap().unwrap();
        assert_eq!(fetched.status, JobStatus::Cancelled);

        // Cancelling again should return false
        assert!(!storage.cancel_job(&job.id).unwrap());
    }

    #[test]
    fn test_unique_key_dedup() {
        let storage = test_storage();

        let mut job1 = make_job("unique_task");
        job1.unique_key = Some("my-key".to_string());
        let j1 = storage.enqueue_unique(job1).unwrap();

        let mut job2 = make_job("unique_task");
        job2.unique_key = Some("my-key".to_string());
        let j2 = storage.enqueue_unique(job2).unwrap();

        // Should return the same job
        assert_eq!(j1.id, j2.id);
    }

    #[test]
    fn test_enqueue_batch() {
        let storage = test_storage();
        let jobs: Vec<NewJob> = (0..5).map(|i| {
            let mut j = make_job(&format!("batch_task_{i}"));
            j.priority = i;
            j
        }).collect();

        let result = storage.enqueue_batch(jobs).unwrap();
        assert_eq!(result.len(), 5);

        let stats = storage.stats().unwrap();
        assert_eq!(stats.pending, 5);
    }

    #[test]
    fn test_record_and_get_job_errors() {
        let storage = test_storage();
        let job = storage.enqueue(make_job("error_task")).unwrap();

        storage.record_error(&job.id, 0, "first failure").unwrap();
        storage.record_error(&job.id, 1, "second failure").unwrap();

        let errors = storage.get_job_errors(&job.id).unwrap();
        assert_eq!(errors.len(), 2);
        assert_eq!(errors[0].attempt, 0);
        assert_eq!(errors[0].error, "first failure");
        assert_eq!(errors[1].attempt, 1);
        assert_eq!(errors[1].error, "second failure");
    }

    #[test]
    fn test_job_errors_empty_for_success() {
        let storage = test_storage();
        let job = storage.enqueue(make_job("ok_task")).unwrap();

        let errors = storage.get_job_errors(&job.id).unwrap();
        assert!(errors.is_empty());
    }

    #[test]
    fn test_purge_job_errors() {
        let storage = test_storage();
        let job = storage.enqueue(make_job("purge_err_task")).unwrap();

        storage.record_error(&job.id, 0, "old error").unwrap();
        // All errors are recorded at now_millis(), so purging with a future cutoff should remove them
        let purged = storage.purge_job_errors(now_millis() + 10_000).unwrap();
        assert_eq!(purged, 1);

        let errors = storage.get_job_errors(&job.id).unwrap();
        assert!(errors.is_empty());
    }

    #[test]
    fn test_progress_tracking() {
        let storage = test_storage();
        let job = storage.enqueue(make_job("progress_task")).unwrap();

        storage.update_progress(&job.id, 50).unwrap();
        let fetched = storage.get_job(&job.id).unwrap().unwrap();
        assert_eq!(fetched.progress, Some(50));

        storage.update_progress(&job.id, 100).unwrap();
        let fetched = storage.get_job(&job.id).unwrap().unwrap();
        assert_eq!(fetched.progress, Some(100));
    }

    // ── Dependency tests ────────────────────────────────────

    #[test]
    fn test_enqueue_with_dependency() {
        let storage = test_storage();
        let job_a = storage.enqueue(make_job("task_a")).unwrap();

        let mut dep_job = make_job("task_b");
        dep_job.depends_on = vec![job_a.id.clone()];
        let job_b = storage.enqueue(dep_job).unwrap();

        let deps = storage.get_dependencies(&job_b.id).unwrap();
        assert_eq!(deps, vec![job_a.id.clone()]);

        let dependents = storage.get_dependents(&job_a.id).unwrap();
        assert_eq!(dependents, vec![job_b.id]);
    }

    #[test]
    fn test_dequeue_blocks_on_unmet_dependency() {
        let storage = test_storage();
        let job_a = storage.enqueue(make_job("dep_task")).unwrap();

        let mut dep_job = make_job("dependent_task");
        dep_job.depends_on = vec![job_a.id.clone()];
        storage.enqueue(dep_job).unwrap();

        let now = now_millis() + 1000;

        // Dequeue should return job_a first (job_b has unmet dep)
        let dequeued = storage.dequeue("default", now).unwrap().unwrap();
        assert_eq!(dequeued.id, job_a.id);

        // job_b should NOT be dequeueable yet (dep not complete)
        let none = storage.dequeue("default", now).unwrap();
        assert!(none.is_none());

        // Complete job_a
        storage.complete(&job_a.id, None).unwrap();

        // Now job_b should be dequeueable
        let dequeued = storage.dequeue("default", now).unwrap().unwrap();
        assert_eq!(dequeued.task_name, "dependent_task");
    }

    #[test]
    fn test_cascade_cancel_on_job_cancel() {
        let storage = test_storage();
        let job_a = storage.enqueue(make_job("root")).unwrap();

        let mut dep_b = make_job("child");
        dep_b.depends_on = vec![job_a.id.clone()];
        let job_b = storage.enqueue(dep_b).unwrap();

        let mut dep_c = make_job("grandchild");
        dep_c.depends_on = vec![job_b.id.clone()];
        let job_c = storage.enqueue(dep_c).unwrap();

        // Cancel root — should cascade to child and grandchild
        storage.cancel_job(&job_a.id).unwrap();

        let b = storage.get_job(&job_b.id).unwrap().unwrap();
        assert_eq!(b.status, JobStatus::Cancelled);

        let c = storage.get_job(&job_c.id).unwrap().unwrap();
        assert_eq!(c.status, JobStatus::Cancelled);
    }

    #[test]
    fn test_cascade_cancel_on_dlq() {
        let storage = test_storage();
        let job_a = storage.enqueue(make_job("parent")).unwrap();

        let mut dep_b = make_job("child_of_dead");
        dep_b.depends_on = vec![job_a.id.clone()];
        let job_b = storage.enqueue(dep_b).unwrap();

        // Dequeue and fail job_a to DLQ
        let now = now_millis() + 1000;
        storage.dequeue("default", now).unwrap();
        let running = storage.get_job(&job_a.id).unwrap().unwrap();
        storage.move_to_dlq(&running, "fatal error", None).unwrap();

        let b = storage.get_job(&job_b.id).unwrap().unwrap();
        assert_eq!(b.status, JobStatus::Cancelled);
        assert!(b.error.unwrap().contains("dependency failed"));
    }

    #[test]
    fn test_enqueue_rejects_missing_dependency() {
        let storage = test_storage();

        let mut dep_job = make_job("orphan");
        dep_job.depends_on = vec!["nonexistent-id".to_string()];
        let result = storage.enqueue(dep_job);
        assert!(result.is_err());
    }
}
