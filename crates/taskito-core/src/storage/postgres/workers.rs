use diesel::prelude::*;

use super::super::models::*;
use super::super::schema::{execution_claims, workers};
use super::PostgresStorage;
use crate::error::Result;
use crate::job::now_millis;

crate::storage::diesel_common::impl_diesel_worker_ops!(PostgresStorage);

impl PostgresStorage {
    /// Register a new worker or update an existing one.
    #[allow(clippy::too_many_arguments)]
    pub fn register_worker(
        &self,
        worker_id: &str,
        queues: &str,
        tags: Option<&str>,
        resources: Option<&str>,
        resource_health: Option<&str>,
        threads: i32,
        hostname: Option<&str>,
        pid: Option<i32>,
        pool_type: Option<&str>,
    ) -> Result<()> {
        let mut conn = self.conn()?;
        let now = now_millis();

        let row = NewWorkerRow {
            worker_id,
            last_heartbeat: now,
            queues,
            status: "active",
            tags,
            resources,
            resource_health,
            threads,
            started_at: Some(now),
            hostname,
            pid,
            pool_type,
        };

        diesel::insert_into(workers::table)
            .values(&row)
            .on_conflict(workers::worker_id)
            .do_update()
            .set(&row)
            .execute(&mut conn)?;

        Ok(())
    }
}
