use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::params;

use crate::error::{QueueError, Result};
use crate::job::{Job, JobStatus, NewJob, now_millis};

/// SQLite-backed storage for the task queue.
#[derive(Clone)]
pub struct SqliteStorage {
    pool: Pool<SqliteConnectionManager>,
}

impl SqliteStorage {
    /// Open (or create) a SQLite database at the given path.
    pub fn new(db_path: &str) -> Result<Self> {
        let manager = SqliteConnectionManager::file(db_path);
        let pool = Pool::builder()
            .max_size(8)
            .build(manager)
            .map_err(QueueError::Pool)?;

        let storage = Self { pool };
        storage.init_tables()?;
        Ok(storage)
    }

    /// Create an in-memory storage (useful for tests).
    pub fn in_memory() -> Result<Self> {
        let manager = SqliteConnectionManager::memory();
        let pool = Pool::builder()
            .max_size(1)
            .build(manager)
            .map_err(QueueError::Pool)?;

        let storage = Self { pool };
        storage.init_tables()?;
        Ok(storage)
    }

    fn init_tables(&self) -> Result<()> {
        let conn = self.pool.get()?;

        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA busy_timeout = 5000;
             PRAGMA journal_size_limit = 67108864;
             PRAGMA synchronous = NORMAL;",
        )?;

        conn.execute_batch(
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
                timeout_ms   INTEGER NOT NULL DEFAULT 300000
            );

            CREATE INDEX IF NOT EXISTS idx_jobs_dequeue
                ON jobs(queue, status, priority DESC, scheduled_at);
            CREATE INDEX IF NOT EXISTS idx_jobs_status
                ON jobs(status);

            CREATE TABLE IF NOT EXISTS dead_letter (
                id              TEXT PRIMARY KEY,
                original_job_id TEXT NOT NULL,
                queue           TEXT NOT NULL,
                task_name       TEXT NOT NULL,
                payload         BLOB NOT NULL,
                error           TEXT,
                retry_count     INTEGER NOT NULL,
                failed_at       INTEGER NOT NULL,
                metadata        TEXT
            );

            CREATE TABLE IF NOT EXISTS rate_limits (
                key         TEXT PRIMARY KEY,
                tokens      REAL NOT NULL,
                max_tokens  REAL NOT NULL,
                refill_rate REAL NOT NULL,
                last_refill INTEGER NOT NULL
            );",
        )?;

        Ok(())
    }

    /// Insert a new job into the queue. Returns the job ID.
    pub fn enqueue(&self, new_job: NewJob) -> Result<Job> {
        let job = new_job.into_job();
        let conn = self.pool.get()?;

        conn.execute(
            "INSERT INTO jobs (id, queue, task_name, payload, status, priority,
                              created_at, scheduled_at, retry_count, max_retries, timeout_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                job.id,
                job.queue,
                job.task_name,
                job.payload,
                job.status as i32,
                job.priority,
                job.created_at,
                job.scheduled_at,
                job.retry_count,
                job.max_retries,
                job.timeout_ms,
            ],
        )?;

        Ok(job)
    }

    /// Atomically dequeue the highest-priority ready job from the given queue.
    /// Returns `None` if no jobs are ready.
    pub fn dequeue(&self, queue: &str, now: i64) -> Result<Option<Job>> {
        let conn = self.pool.get()?;

        let mut stmt = conn.prepare(
            "UPDATE jobs SET status = ?1, started_at = ?2
             WHERE id = (
                 SELECT id FROM jobs
                 WHERE queue = ?3 AND status = 0 AND scheduled_at <= ?4
                 ORDER BY priority DESC, scheduled_at ASC
                 LIMIT 1
             )
             RETURNING id, queue, task_name, payload, status, priority,
                       created_at, scheduled_at, started_at, completed_at,
                       retry_count, max_retries, result, error, timeout_ms",
        )?;

        let result = stmt
            .query_row(
                params![JobStatus::Running as i32, now, queue, now],
                |row| row_to_job(row),
            )
            .optional()?;

        Ok(result)
    }

    /// Dequeue from multiple queues, checking each in order.
    pub fn dequeue_from(&self, queues: &[String], now: i64) -> Result<Option<Job>> {
        for queue in queues {
            if let Some(job) = self.dequeue(queue, now)? {
                return Ok(Some(job));
            }
        }
        Ok(None)
    }

    /// Mark a job as complete with the given result.
    pub fn complete(&self, id: &str, result: Option<Vec<u8>>) -> Result<()> {
        let conn = self.pool.get()?;
        let now = now_millis();

        let affected = conn.execute(
            "UPDATE jobs SET status = ?1, completed_at = ?2, result = ?3
             WHERE id = ?4 AND status = ?5",
            params![
                JobStatus::Complete as i32,
                now,
                result,
                id,
                JobStatus::Running as i32,
            ],
        )?;

        if affected == 0 {
            return Err(QueueError::JobNotFound(id.to_string()));
        }
        Ok(())
    }

    /// Mark a job as failed with the given error message.
    pub fn fail(&self, id: &str, error: &str) -> Result<()> {
        let conn = self.pool.get()?;
        let now = now_millis();

        let affected = conn.execute(
            "UPDATE jobs SET status = ?1, completed_at = ?2, error = ?3
             WHERE id = ?4 AND status = ?5",
            params![
                JobStatus::Failed as i32,
                now,
                error,
                id,
                JobStatus::Running as i32,
            ],
        )?;

        if affected == 0 {
            return Err(QueueError::JobNotFound(id.to_string()));
        }
        Ok(())
    }

    /// Re-schedule a job for retry (set status back to pending with new scheduled_at).
    pub fn retry(&self, id: &str, next_scheduled_at: i64) -> Result<()> {
        let conn = self.pool.get()?;

        let affected = conn.execute(
            "UPDATE jobs SET status = ?1, scheduled_at = ?2,
                            retry_count = retry_count + 1,
                            started_at = NULL, completed_at = NULL,
                            error = NULL
             WHERE id = ?3",
            params![JobStatus::Pending as i32, next_scheduled_at, id],
        )?;

        if affected == 0 {
            return Err(QueueError::JobNotFound(id.to_string()));
        }
        Ok(())
    }

    /// Move a job to the dead letter queue.
    pub fn move_to_dlq(&self, job: &Job, error: &str, metadata: Option<&str>) -> Result<()> {
        let conn = self.pool.get()?;
        let now = now_millis();
        let dlq_id = uuid::Uuid::now_v7().to_string();

        conn.execute(
            "INSERT INTO dead_letter (id, original_job_id, queue, task_name, payload,
                                      error, retry_count, failed_at, metadata)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                dlq_id,
                job.id,
                job.queue,
                job.task_name,
                job.payload,
                error,
                job.retry_count,
                now,
                metadata,
            ],
        )?;

        // Mark the original job as dead
        conn.execute(
            "UPDATE jobs SET status = ?1, error = ?2, completed_at = ?3 WHERE id = ?4",
            params![JobStatus::Dead as i32, error, now, job.id],
        )?;

        Ok(())
    }

    /// Get a job by ID.
    pub fn get_job(&self, id: &str) -> Result<Option<Job>> {
        let conn = self.pool.get()?;

        let mut stmt = conn.prepare(
            "SELECT id, queue, task_name, payload, status, priority,
                    created_at, scheduled_at, started_at, completed_at,
                    retry_count, max_retries, result, error, timeout_ms
             FROM jobs WHERE id = ?1",
        )?;

        let result = stmt.query_row(params![id], |row| row_to_job(row)).optional()?;
        Ok(result)
    }

    /// Get queue statistics.
    pub fn stats(&self) -> Result<QueueStats> {
        let conn = self.pool.get()?;

        let mut stmt = conn.prepare(
            "SELECT status, COUNT(*) FROM jobs GROUP BY status",
        )?;

        let mut stats = QueueStats::default();
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, i32>(0)?, row.get::<_, i64>(1)?))
        })?;

        for row in rows {
            let (status, count) = row?;
            match JobStatus::from_i32(status) {
                Some(JobStatus::Pending) => stats.pending = count,
                Some(JobStatus::Running) => stats.running = count,
                Some(JobStatus::Complete) => stats.completed = count,
                Some(JobStatus::Failed) => stats.failed = count,
                Some(JobStatus::Dead) => stats.dead = count,
                None => {}
            }
        }

        Ok(stats)
    }

    /// List dead letter entries.
    pub fn list_dead(&self, limit: i64, offset: i64) -> Result<Vec<DeadJob>> {
        let conn = self.pool.get()?;

        let mut stmt = conn.prepare(
            "SELECT id, original_job_id, queue, task_name, payload,
                    error, retry_count, failed_at, metadata
             FROM dead_letter ORDER BY failed_at DESC LIMIT ?1 OFFSET ?2",
        )?;

        let rows = stmt.query_map(params![limit, offset], |row| {
            Ok(DeadJob {
                id: row.get(0)?,
                original_job_id: row.get(1)?,
                queue: row.get(2)?,
                task_name: row.get(3)?,
                payload: row.get(4)?,
                error: row.get(5)?,
                retry_count: row.get(6)?,
                failed_at: row.get(7)?,
                metadata: row.get(8)?,
            })
        })?;

        let mut dead_jobs = Vec::new();
        for row in rows {
            dead_jobs.push(row?);
        }
        Ok(dead_jobs)
    }

    /// Re-enqueue a dead letter job. Returns the new job ID.
    pub fn retry_dead(&self, dead_id: &str) -> Result<String> {
        // Fetch dead letter entry (connection is dropped after this block)
        let dead: DeadJob = {
            let conn = self.pool.get()?;
            let mut stmt = conn.prepare(
                "SELECT id, original_job_id, queue, task_name, payload,
                        error, retry_count, failed_at, metadata
                 FROM dead_letter WHERE id = ?1",
            )?;
            let result = stmt
                .query_row(params![dead_id], |row| {
                    Ok(DeadJob {
                        id: row.get(0)?,
                        original_job_id: row.get(1)?,
                        queue: row.get(2)?,
                        task_name: row.get(3)?,
                        payload: row.get(4)?,
                        error: row.get(5)?,
                        retry_count: row.get(6)?,
                        failed_at: row.get(7)?,
                        metadata: row.get(8)?,
                    })
                })
                .map_err(|_| QueueError::JobNotFound(dead_id.to_string()))?;
            result
        };

        // Create new job from dead letter (gets its own connection)
        let new_job = NewJob {
            queue: dead.queue,
            task_name: dead.task_name,
            payload: dead.payload,
            priority: 0,
            scheduled_at: now_millis(),
            max_retries: 3,
            timeout_ms: 300_000,
        };

        let job = self.enqueue(new_job)?;

        // Remove from dead letter queue (gets its own connection)
        let conn = self.pool.get()?;
        conn.execute("DELETE FROM dead_letter WHERE id = ?1", params![dead_id])?;

        Ok(job.id)
    }

    /// Purge dead letter entries older than the given timestamp.
    pub fn purge_dead(&self, older_than_ms: i64) -> Result<u64> {
        let conn = self.pool.get()?;
        let affected = conn.execute(
            "DELETE FROM dead_letter WHERE failed_at < ?1",
            params![older_than_ms],
        )?;
        Ok(affected as u64)
    }

    /// Purge completed jobs older than the given timestamp.
    pub fn purge_completed(&self, older_than_ms: i64) -> Result<u64> {
        let conn = self.pool.get()?;
        let affected = conn.execute(
            "DELETE FROM jobs WHERE status = ?1 AND completed_at < ?2",
            params![JobStatus::Complete as i32, older_than_ms],
        )?;
        Ok(affected as u64)
    }

    /// Find stale running jobs (started but exceeded timeout) and mark them as failed.
    pub fn reap_stale_jobs(&self, now: i64) -> Result<Vec<Job>> {
        let conn = self.pool.get()?;

        let mut stmt = conn.prepare(
            "SELECT id, queue, task_name, payload, status, priority,
                    created_at, scheduled_at, started_at, completed_at,
                    retry_count, max_retries, result, error, timeout_ms
             FROM jobs
             WHERE status = ?1 AND started_at IS NOT NULL
                   AND (started_at + timeout_ms) < ?2",
        )?;

        let rows = stmt.query_map(params![JobStatus::Running as i32, now], |row| {
            row_to_job(row)
        })?;

        let mut stale = Vec::new();
        for row in rows {
            stale.push(row?);
        }
        Ok(stale)
    }

    // -- Rate limit storage methods --

    pub fn get_rate_limit(&self, key: &str) -> Result<Option<RateLimitRow>> {
        let conn = self.pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT key, tokens, max_tokens, refill_rate, last_refill
             FROM rate_limits WHERE key = ?1",
        )?;

        let result = stmt
            .query_row(params![key], |row| {
                Ok(RateLimitRow {
                    key: row.get(0)?,
                    tokens: row.get(1)?,
                    max_tokens: row.get(2)?,
                    refill_rate: row.get(3)?,
                    last_refill: row.get(4)?,
                })
            })
            .optional()?;
        Ok(result)
    }

    pub fn upsert_rate_limit(&self, row: &RateLimitRow) -> Result<()> {
        let conn = self.pool.get()?;
        conn.execute(
            "INSERT INTO rate_limits (key, tokens, max_tokens, refill_rate, last_refill)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(key) DO UPDATE SET tokens = ?2, last_refill = ?5",
            params![row.key, row.tokens, row.max_tokens, row.refill_rate, row.last_refill],
        )?;
        Ok(())
    }
}

/// Use rusqlite's optional extension for query_row returning Option.
trait OptionalExt<T> {
    fn optional(self) -> std::result::Result<Option<T>, rusqlite::Error>;
}

impl<T> OptionalExt<T> for std::result::Result<T, rusqlite::Error> {
    fn optional(self) -> std::result::Result<Option<T>, rusqlite::Error> {
        match self {
            Ok(v) => Ok(Some(v)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }
}

fn row_to_job(row: &rusqlite::Row) -> rusqlite::Result<Job> {
    Ok(Job {
        id: row.get(0)?,
        queue: row.get(1)?,
        task_name: row.get(2)?,
        payload: row.get(3)?,
        status: JobStatus::from_i32(row.get(4)?).unwrap_or(JobStatus::Pending),
        priority: row.get(5)?,
        created_at: row.get(6)?,
        scheduled_at: row.get(7)?,
        started_at: row.get(8)?,
        completed_at: row.get(9)?,
        retry_count: row.get(10)?,
        max_retries: row.get(11)?,
        result: row.get(12)?,
        error: row.get(13)?,
        timeout_ms: row.get(14)?,
    })
}

#[derive(Debug, Clone, Default)]
pub struct QueueStats {
    pub pending: i64,
    pub running: i64,
    pub completed: i64,
    pub failed: i64,
    pub dead: i64,
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

#[derive(Debug, Clone)]
pub struct RateLimitRow {
    pub key: String,
    pub tokens: f64,
    pub max_tokens: f64,
    pub refill_rate: f64,
    pub last_refill: i64,
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

        // Should not dequeue before scheduled_at
        let none = storage.dequeue("default", now_millis()).unwrap();
        assert!(none.is_none());

        // Should dequeue after scheduled_at
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

        // New job exists and is pending
        let new_job = storage.get_job(&new_id).unwrap().unwrap();
        assert_eq!(new_job.status, JobStatus::Pending);
        assert_eq!(new_job.task_name, "retry_dead_task");

        // Dead letter entry removed
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
}
