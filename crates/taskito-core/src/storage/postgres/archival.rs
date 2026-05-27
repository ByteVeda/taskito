use diesel::prelude::*;

use super::super::models::ArchivedJobRow;
use super::super::schema::archived_jobs;
use super::PostgresStorage;
use crate::error::Result;
use crate::job::{Job, JobStatus};

crate::storage::diesel_common::impl_diesel_archival_ops!(PostgresStorage);

impl PostgresStorage {
    pub fn archive_old_jobs(&self, cutoff_ms: i64) -> Result<u64> {
        let mut conn = self.conn()?;

        let archivable_statuses = format!(
            "{}, {}, {}",
            JobStatus::Complete as i32,
            JobStatus::Dead as i32,
            JobStatus::Cancelled as i32,
        );

        conn.transaction(|conn| {
            let affected = diesel::sql_query(format!(
                "INSERT INTO archived_jobs SELECT * FROM jobs \
                 WHERE status IN ({archivable_statuses}) AND completed_at IS NOT NULL AND completed_at < $1 \
                 ON CONFLICT (id) DO NOTHING",
            ))
            .bind::<diesel::sql_types::BigInt, _>(cutoff_ms)
            .execute(conn)?;

            diesel::sql_query(format!(
                "DELETE FROM jobs WHERE status IN ({archivable_statuses}) AND completed_at IS NOT NULL AND completed_at < $1",
            ))
            .bind::<diesel::sql_types::BigInt, _>(cutoff_ms)
            .execute(conn)?;

            Ok(affected as u64)
        })
    }
}
