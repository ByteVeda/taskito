use diesel::prelude::*;

use super::super::models::*;
use super::super::schema::{distributed_locks, execution_claims};
use super::PostgresStorage;
use crate::error::Result;
use crate::job::now_millis;

// Shared lock operations (release, extend, get_info, reap, complete_execution, purge_claims)
crate::storage::diesel_common::impl_diesel_lock_ops!(PostgresStorage);

impl PostgresStorage {
    /// Try to acquire a distributed lock. Returns true if acquired.
    /// Uses SELECT FOR UPDATE SKIP LOCKED for pool-safe locking.
    pub fn acquire_lock(&self, lock_name: &str, owner_id: &str, ttl_ms: i64) -> Result<bool> {
        let mut conn = self.conn()?;
        let now = now_millis();

        conn.transaction(|conn| {
            // Try to get existing lock with FOR UPDATE SKIP LOCKED
            let existing: Option<LockInfoRow> = diesel::sql_query(
                "SELECT lock_name, owner_id, acquired_at, expires_at \
                 FROM distributed_locks WHERE lock_name = $1 FOR UPDATE SKIP LOCKED",
            )
            .bind::<diesel::sql_types::Text, _>(lock_name)
            .get_result(conn)
            .optional()?;

            match existing {
                Some(lock) if lock.expires_at > now => {
                    // Lock is held and not expired
                    Ok(false)
                }
                Some(_) => {
                    // Lock exists but expired — update it
                    diesel::update(distributed_locks::table.find(lock_name))
                        .set((
                            distributed_locks::owner_id.eq(owner_id),
                            distributed_locks::acquired_at.eq(now),
                            distributed_locks::expires_at.eq(now + ttl_ms),
                        ))
                        .execute(conn)?;
                    Ok(true)
                }
                None => {
                    // No lock row — insert
                    diesel::insert_into(distributed_locks::table)
                        .values(&NewLockRow {
                            lock_name,
                            owner_id,
                            acquired_at: now,
                            expires_at: now + ttl_ms,
                        })
                        .on_conflict(distributed_locks::lock_name)
                        .do_nothing()
                        .execute(conn)?;
                    // Check if we actually got it (race condition with other inserter)
                    let lock: Option<LockInfoRow> = distributed_locks::table
                        .find(lock_name)
                        .select(LockInfoRow::as_select())
                        .first(conn)
                        .optional()?;
                    Ok(lock.is_some_and(|l| l.owner_id == owner_id))
                }
            }
        })
    }

    /// Claim exclusive execution of a job. Returns true if claimed.
    pub fn claim_execution(&self, job_id: &str, worker_id: &str) -> Result<bool> {
        let mut conn = self.conn()?;
        let now = now_millis();

        let result = diesel::insert_into(execution_claims::table)
            .values(&NewExecutionClaimRow {
                job_id,
                worker_id,
                claimed_at: now,
            })
            .on_conflict(execution_claims::job_id)
            .do_nothing()
            .execute(&mut conn)?;

        Ok(result > 0)
    }
}
