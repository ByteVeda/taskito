use diesel::prelude::*;

use crate::error::Result;
use crate::job::now_millis;
use super::super::models::*;
use super::super::schema::workers;
use super::SqliteStorage;

/// Dead worker threshold: 30 seconds without heartbeat.
const DEAD_WORKER_THRESHOLD_MS: i64 = 30_000;

impl SqliteStorage {
    /// Register a new worker or update an existing one.
    pub fn register_worker(&self, worker_id: &str, queues: &str) -> Result<()> {
        let mut conn = self.conn()?;
        let now = now_millis();

        let row = NewWorkerRow {
            worker_id,
            last_heartbeat: now,
            queues,
            status: "active",
        };

        diesel::replace_into(workers::table)
            .values(&row)
            .execute(&mut conn)?;

        Ok(())
    }

    /// Update the heartbeat timestamp for a worker.
    pub fn heartbeat(&self, worker_id: &str) -> Result<()> {
        let mut conn = self.conn()?;
        let now = now_millis();

        diesel::update(workers::table)
            .filter(workers::worker_id.eq(worker_id))
            .set(workers::last_heartbeat.eq(now))
            .execute(&mut conn)?;

        Ok(())
    }

    /// List all workers with their heartbeat status.
    pub fn list_workers(&self) -> Result<Vec<WorkerRow>> {
        let mut conn = self.conn()?;

        let rows = workers::table
            .select(WorkerRow::as_select())
            .load(&mut conn)?;

        Ok(rows)
    }

    /// Remove workers that haven't sent a heartbeat within the threshold.
    pub fn reap_dead_workers(&self) -> Result<u64> {
        let mut conn = self.conn()?;
        let cutoff = now_millis() - DEAD_WORKER_THRESHOLD_MS;

        let affected = diesel::delete(
            workers::table.filter(workers::last_heartbeat.lt(cutoff))
        ).execute(&mut conn)?;

        Ok(affected as u64)
    }

    /// Unregister a worker (called on shutdown).
    pub fn unregister_worker(&self, worker_id: &str) -> Result<()> {
        let mut conn = self.conn()?;

        diesel::delete(workers::table.filter(workers::worker_id.eq(worker_id)))
            .execute(&mut conn)?;

        Ok(())
    }
}
