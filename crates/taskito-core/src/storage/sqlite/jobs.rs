use diesel::prelude::*;
use diesel::sqlite::SqliteConnection;

use super::super::models::*;
use super::super::schema::{
    archived_jobs, job_dependencies, job_errors, job_payloads, jobs, replay_history, task_logs,
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
}
