use diesel::pg::PgConnection;
use diesel::prelude::*;

use super::super::models::*;
use super::super::schema::{
    archived_jobs, execution_claims, job_dependencies, job_errors, jobs, replay_history, task_logs,
    task_metrics,
};
use super::PostgresStorage;
use crate::error::{QueueError, Result};
use crate::job::{now_millis, Job, JobStatus, NewJob};
use crate::storage::QueueStats;

crate::storage::diesel_common::impl_diesel_job_ops!(PostgresStorage, PgConnection);

impl PostgresStorage {
    /// Run a read-then-write unit of work in a transaction. Postgres serializes
    /// row-level writes without the SQLite lock-upgrade deadlock, so a regular
    /// transaction suffices; this mirrors [`SqliteStorage::write_transaction`]
    /// so the shared job-ops macro can call one name on both backends.
    pub(crate) fn write_transaction<T, F>(&self, f: F) -> Result<T>
    where
        F: FnOnce(&mut PgConnection) -> std::result::Result<T, QueueError>,
    {
        let mut pooled = self.conn()?;
        let conn: &mut PgConnection = &mut pooled;
        conn.transaction(f)
    }

    /// Load up to `limit` ready candidate rows (narrow — no payload/result
    /// blobs) for a dequeue, locking each with `FOR UPDATE SKIP LOCKED`.
    ///
    /// SKIP LOCKED is what lets many Postgres workers dequeue concurrently
    /// without contending: each worker's scan skips rows another worker has
    /// already locked in its open transaction, so they claim disjoint sets
    /// instead of all racing on the same head rows. Runs inside the caller's
    /// `write_transaction`, which holds the locks until the claim commits.
    ///
    /// Locking is not available on a boxed query in Diesel, so the namespace
    /// filter is branched into two concrete (un-boxed) statements rather than
    /// built dynamically.
    fn scan_dequeue_candidates(
        conn: &mut PgConnection,
        queue_name: &str,
        now: i64,
        namespace: Option<&str>,
        limit: i64,
        order: crate::storage::DispatchOrder,
    ) -> diesel::result::QueryResult<Vec<NarrowJobRow>> {
        use crate::storage::DispatchOrder;
        let base = jobs::table
            .filter(jobs::queue.eq(queue_name))
            .filter(jobs::status.eq(JobStatus::Pending as i32))
            .filter(jobs::scheduled_at.le(now));

        // `SKIP LOCKED` needs a concrete (un-boxed) statement, so the namespace
        // filter and the order direction are each branched rather than built
        // dynamically. Priority always dominates; the (scheduled_at, id)
        // tie-break flips with the dispatch order (UUIDv7 `id` = deterministic
        // time-ordered final key).
        match (namespace, order) {
            (Some(ns), DispatchOrder::Fifo) => base
                .filter(jobs::namespace.eq(ns))
                .order((
                    jobs::priority.desc(),
                    jobs::scheduled_at.asc(),
                    jobs::id.asc(),
                ))
                .limit(limit)
                .select(NarrowJobRow::as_select())
                .for_update()
                .skip_locked()
                .load(conn),
            (Some(ns), DispatchOrder::Lifo) => base
                .filter(jobs::namespace.eq(ns))
                .order((
                    jobs::priority.desc(),
                    jobs::scheduled_at.desc(),
                    jobs::id.desc(),
                ))
                .limit(limit)
                .select(NarrowJobRow::as_select())
                .for_update()
                .skip_locked()
                .load(conn),
            (None, DispatchOrder::Fifo) => base
                .filter(jobs::namespace.is_null())
                .order((
                    jobs::priority.desc(),
                    jobs::scheduled_at.asc(),
                    jobs::id.asc(),
                ))
                .limit(limit)
                .select(NarrowJobRow::as_select())
                .for_update()
                .skip_locked()
                .load(conn),
            (None, DispatchOrder::Lifo) => base
                .filter(jobs::namespace.is_null())
                .order((
                    jobs::priority.desc(),
                    jobs::scheduled_at.desc(),
                    jobs::id.desc(),
                ))
                .limit(limit)
                .select(NarrowJobRow::as_select())
                .for_update()
                .skip_locked()
                .load(conn),
        }
    }
}
