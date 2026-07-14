/// Generates the shared `list_archived` method for Diesel-backed storage backends.
///
/// `archive_old_jobs` differs between SQLite (`INSERT OR IGNORE`) and Postgres
/// (`ON CONFLICT DO NOTHING` + `$1` bind syntax), so it remains backend-specific.
macro_rules! impl_diesel_archival_ops {
    ($storage_type:ty) => {
        impl $storage_type {
            /// List archived jobs with pagination.
            pub fn list_archived(&self, limit: i64, offset: i64) -> Result<Vec<Job>> {
                let mut conn = self.conn()?;

                // Narrow projection: archive listings never render the
                // arg/result blobs, so leave them on TOAST/overflow pages.
                let rows: Vec<NarrowArchivedJobRow> = archived_jobs::table
                    .order(archived_jobs::completed_at.desc())
                    .limit(limit)
                    .offset(offset)
                    .select(NarrowArchivedJobRow::as_select())
                    .load(&mut conn)?;

                Ok(rows.into_iter().map(Job::from_narrow_archived).collect())
            }
        }
    };
}

pub(crate) use impl_diesel_archival_ops;
