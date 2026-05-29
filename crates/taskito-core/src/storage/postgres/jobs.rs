use diesel::pg::PgConnection;
use diesel::prelude::*;

use super::super::models::*;
use super::super::schema::{
    archived_jobs, job_dependencies, job_errors, jobs, replay_history, task_logs, task_metrics,
};
use super::PostgresStorage;
use crate::error::{QueueError, Result};
use crate::job::{now_millis, Job, JobStatus, NewJob};
use crate::storage::QueueStats;

crate::storage::diesel_common::impl_diesel_job_ops!(PostgresStorage, PgConnection);

impl PostgresStorage {
    /// Run a read-then-write unit of work in a transaction. Postgres serializes
    /// row-level writes without the SQLite lock-upgrade deadlock, so a regular
    /// transaction suffices; this mirrors [`SqliteStorage::archive_transaction`]
    /// so the shared job-ops macro can call one name on both backends.
    pub(crate) fn archive_transaction<T, F>(&self, f: F) -> Result<T>
    where
        F: FnOnce(&mut PgConnection) -> std::result::Result<T, QueueError>,
    {
        let mut pooled = self.conn()?;
        let conn: &mut PgConnection = &mut pooled;
        conn.transaction(f)
    }
}
