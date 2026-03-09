use diesel::prelude::*;

use super::super::models::*;
use super::super::schema::{distributed_locks, execution_claims};
use super::SqliteStorage;
use crate::error::Result;
use crate::job::now_millis;

// Shared lock operations (release, extend, get_info, reap, complete_execution, purge_claims)
crate::storage::diesel_common::impl_diesel_lock_ops!(SqliteStorage);

impl SqliteStorage {
    /// Try to acquire a distributed lock. Returns true if acquired.
    pub fn acquire_lock(&self, lock_name: &str, owner_id: &str, ttl_ms: i64) -> Result<bool> {
        let mut conn = self.conn()?;
        let now = now_millis();

        conn.exclusive_transaction(|conn| {
            // Check if lock exists and is still valid
            let existing: Option<LockInfoRow> = distributed_locks::table
                .find(lock_name)
                .select(LockInfoRow::as_select())
                .first(conn)
                .optional()?;

            match existing {
                Some(lock) if lock.expires_at > now => {
                    // Lock is held and not expired
                    Ok(false)
                }
                _ => {
                    // Lock is free or expired — take it
                    diesel::replace_into(distributed_locks::table)
                        .values(&NewLockRow {
                            lock_name,
                            owner_id,
                            acquired_at: now,
                            expires_at: now + ttl_ms,
                        })
                        .execute(conn)?;
                    Ok(true)
                }
            }
        })
    }

    /// Claim exclusive execution of a job. Returns true if claimed.
    pub fn claim_execution(&self, job_id: &str, worker_id: &str) -> Result<bool> {
        let mut conn = self.conn()?;
        let now = now_millis();

        // Try to insert — if already exists, another worker claimed it
        let result = diesel::insert_into(execution_claims::table)
            .values(&NewExecutionClaimRow {
                job_id,
                worker_id,
                claimed_at: now,
            })
            .execute(&mut conn);

        match result {
            Ok(_) => Ok(true),
            Err(diesel::result::Error::DatabaseError(
                diesel::result::DatabaseErrorKind::UniqueViolation,
                _,
            )) => Ok(false),
            Err(e) => Err(e.into()),
        }
    }
}
