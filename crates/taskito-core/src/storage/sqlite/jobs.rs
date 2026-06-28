use diesel::prelude::*;
use diesel::sqlite::SqliteConnection;

use super::super::models::*;
use super::super::schema::{
    archived_jobs, execution_claims, job_dependencies, job_errors, jobs, replay_history, task_logs,
    task_metrics,
};
use super::SqliteStorage;
use crate::error::{QueueError, Result};
use crate::job::{now_millis, Job, JobStatus, NewJob};
use crate::storage::QueueStats;

crate::storage::diesel_common::impl_diesel_job_ops!(SqliteStorage, SqliteConnection);

impl SqliteStorage {
    /// Run a read-then-write unit of work under a write-priority transaction.
    ///
    /// Any sequence that reads a row and then writes it (dequeue/claim, enqueue
    /// with dependency validation, unique-key dedup, DLQ/archive moves, rate-limit
    /// token consume) must use this. Under SQLite a plain deferred transaction
    /// starts as a reader and must later upgrade to a writer; two such
    /// transactions racing each other deadlock and surface as `SQLITE_BUSY`
    /// ("database is locked") without honoring `busy_timeout`. `BEGIN IMMEDIATE`
    /// takes the write lock up front so the busy-timeout backoff applies and the
    /// operations serialize cleanly. The Postgres twin is a plain transaction
    /// (MVCC has no deferred-upgrade hazard), so the name is uniform across
    /// backends and callers never pick the wrong transaction kind.
    pub(crate) fn write_transaction<T, F>(&self, f: F) -> Result<T>
    where
        F: FnOnce(&mut SqliteConnection) -> std::result::Result<T, QueueError>,
    {
        let mut conn = self.conn()?;
        conn.immediate_transaction(f)
    }

    /// Load up to `limit` ready candidate rows (narrow — no payload/result
    /// blobs) for a dequeue. SQLite needs no row-level locking clause: the
    /// `BEGIN IMMEDIATE` write transaction already serializes writers, so two
    /// dequeues never scan the same uncommitted candidates concurrently.
    fn scan_dequeue_candidates(
        conn: &mut SqliteConnection,
        queue_name: &str,
        now: i64,
        namespace: Option<&str>,
        limit: i64,
    ) -> diesel::result::QueryResult<Vec<NarrowJobRow>> {
        let mut query = jobs::table
            .filter(jobs::queue.eq(queue_name))
            .filter(jobs::status.eq(JobStatus::Pending as i32))
            .filter(jobs::scheduled_at.le(now))
            .order((jobs::priority.desc(), jobs::scheduled_at.asc()))
            .limit(limit)
            .into_boxed();
        query = match namespace {
            Some(ns) => query.filter(jobs::namespace.eq(ns)),
            None => query.filter(jobs::namespace.is_null()),
        };
        query.select(NarrowJobRow::as_select()).load(conn)
    }
}
