use diesel::prelude::*;

use super::super::models::ArchivedJobRow;
use super::super::schema::archived_jobs;
use super::SqliteStorage;
use crate::error::Result;
use crate::job::{Job, JobStatus};

crate::storage::diesel_common::impl_diesel_archival_ops!(SqliteStorage);

impl SqliteStorage {
    /// Archive completed/dead/cancelled jobs older than cutoff_ms.
    /// Moves them from `jobs` to `archived_jobs`.
    pub fn archive_old_jobs(&self, cutoff_ms: i64) -> Result<u64> {
        let mut conn = self.conn()?;

        let archivable_statuses = format!(
            "{}, {}, {}",
            JobStatus::Complete as i32,
            JobStatus::Dead as i32,
            JobStatus::Cancelled as i32,
        );

        conn.transaction(|conn| {
            // Use raw SQL for INSERT INTO ... SELECT across tables
            let affected = diesel::sql_query(format!(
                "INSERT OR IGNORE INTO archived_jobs SELECT * FROM jobs \
                 WHERE status IN ({archivable_statuses}) AND completed_at IS NOT NULL AND completed_at < ?1",
            ))
            .bind::<diesel::sql_types::BigInt, _>(cutoff_ms)
            .execute(conn)?;

            diesel::sql_query(format!(
                "DELETE FROM jobs WHERE status IN ({archivable_statuses}) AND completed_at IS NOT NULL AND completed_at < ?1",
            ))
            .bind::<diesel::sql_types::BigInt, _>(cutoff_ms)
            .execute(conn)?;

            Ok(affected as u64)
        })
    }
}
