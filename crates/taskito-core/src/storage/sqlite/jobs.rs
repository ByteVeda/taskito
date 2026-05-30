use diesel::prelude::*;
use diesel::sqlite::SqliteConnection;

use super::super::models::*;
use super::super::schema::{
    archived_jobs, job_dependencies, job_errors, jobs, replay_history, task_logs, task_metrics,
};
use super::SqliteStorage;
use crate::error::{QueueError, Result};
use crate::job::{now_millis, Job, JobStatus, NewJob};
use crate::storage::QueueStats;

crate::storage::diesel_common::impl_diesel_job_ops!(SqliteStorage, SqliteConnection);

impl SqliteStorage {
    /// Run a read-then-write unit of work under a write-priority transaction.
    ///
    /// Archival reads a job row and then INSERTs/DELETEs it. Under SQLite a
    /// plain deferred transaction starts as a reader and must later upgrade to
    /// a writer; two such transactions racing each other deadlock and surface
    /// as `SQLITE_BUSY` ("database is locked") without honoring `busy_timeout`.
    /// `BEGIN IMMEDIATE` takes the write lock up front so the busy-timeout
    /// backoff applies and the operations serialize cleanly.
    pub(crate) fn archive_transaction<T, F>(&self, f: F) -> Result<T>
    where
        F: FnOnce(&mut SqliteConnection) -> std::result::Result<T, QueueError>,
    {
        let mut conn = self.conn()?;
        conn.immediate_transaction(f)
    }
}
