use redis::Commands;

use super::{map_err, RedisStorage};
use crate::error::Result;
use crate::job::now_millis;
use crate::storage::models::LockInfoRow;

/// Lua script: release lock only if owner matches.
const RELEASE_LOCK_SCRIPT: &str = r#"
    local key = KEYS[1]
    local owner = ARGV[1]
    local current = redis.call('HGET', key, 'owner_id')
    if current == owner then
        redis.call('DEL', key)
        return 1
    end
    return 0
"#;

/// Lua script: extend lock TTL only if owner matches.
const EXTEND_LOCK_SCRIPT: &str = r#"
    local key = KEYS[1]
    local owner = ARGV[1]
    local new_expires = ARGV[2]
    local current = redis.call('HGET', key, 'owner_id')
    if current == owner then
        redis.call('HSET', key, 'expires_at', new_expires)
        return 1
    end
    return 0
"#;

/// Lua script: acquire lock atomically (SET NX equivalent with hash).
const ACQUIRE_LOCK_SCRIPT: &str = r#"
    local key = KEYS[1]
    local owner = ARGV[1]
    local acquired_at = ARGV[2]
    local expires_at = ARGV[3]
    local now = ARGV[4]
    local existing_expires = redis.call('HGET', key, 'expires_at')
    if existing_expires and tonumber(existing_expires) > tonumber(now) then
        return 0
    end
    redis.call('HSET', key, 'lock_name', KEYS[2], 'owner_id', owner,
               'acquired_at', acquired_at, 'expires_at', expires_at)
    return 1
"#;

impl RedisStorage {
    pub fn acquire_lock(&self, lock_name: &str, owner_id: &str, ttl_ms: i64) -> Result<bool> {
        let mut conn = self.conn()?;
        let now = now_millis();
        let expires_at = now + ttl_ms;
        let lkey = self.key(&["lock", lock_name]);

        let result: i32 = redis::Script::new(ACQUIRE_LOCK_SCRIPT)
            .key(&lkey)
            .key(lock_name)
            .arg(owner_id)
            .arg(now)
            .arg(expires_at)
            .arg(now)
            .invoke(&mut conn)
            .map_err(map_err)?;

        Ok(result == 1)
    }

    pub fn release_lock(&self, lock_name: &str, owner_id: &str) -> Result<bool> {
        let mut conn = self.conn()?;
        let lkey = self.key(&["lock", lock_name]);

        let result: i32 = redis::Script::new(RELEASE_LOCK_SCRIPT)
            .key(&lkey)
            .arg(owner_id)
            .invoke(&mut conn)
            .map_err(map_err)?;

        Ok(result == 1)
    }

    pub fn extend_lock(&self, lock_name: &str, owner_id: &str, ttl_ms: i64) -> Result<bool> {
        let mut conn = self.conn()?;
        let now = now_millis();
        let new_expires = now + ttl_ms;
        let lkey = self.key(&["lock", lock_name]);

        let result: i32 = redis::Script::new(EXTEND_LOCK_SCRIPT)
            .key(&lkey)
            .arg(owner_id)
            .arg(new_expires)
            .invoke(&mut conn)
            .map_err(map_err)?;

        Ok(result == 1)
    }

    pub fn get_lock_info(&self, lock_name: &str) -> Result<Option<LockInfoRow>> {
        let mut conn = self.conn()?;
        let lkey = self.key(&["lock", lock_name]);

        let data: std::collections::HashMap<String, String> =
            conn.hgetall(&lkey).map_err(map_err)?;

        if data.is_empty() {
            return Ok(None);
        }

        Ok(Some(LockInfoRow {
            lock_name: data
                .get("lock_name")
                .cloned()
                .unwrap_or_else(|| lock_name.to_string()),
            owner_id: data.get("owner_id").cloned().unwrap_or_default(),
            acquired_at: data
                .get("acquired_at")
                .and_then(|s| s.parse().ok())
                .unwrap_or(0),
            expires_at: data
                .get("expires_at")
                .and_then(|s| s.parse().ok())
                .unwrap_or(0),
        }))
    }

    pub fn reap_expired_locks(&self, now: i64) -> Result<u64> {
        let mut conn = self.conn()?;
        let pattern = self.key(&["lock", "*"]);

        let mut count = 0u64;
        let mut cursor: u64 = 0;
        loop {
            let (next_cursor, keys): (u64, Vec<String>) = redis::cmd("SCAN")
                .arg(cursor)
                .arg("MATCH")
                .arg(&pattern)
                .arg("COUNT")
                .arg(100)
                .query(&mut conn)
                .map_err(map_err)?;

            for key in keys {
                let expires_at: Option<i64> = conn.hget(&key, "expires_at").map_err(map_err)?;
                if let Some(exp) = expires_at {
                    if exp <= now {
                        conn.del::<_, ()>(&key).map_err(map_err)?;
                        count += 1;
                    }
                }
            }

            cursor = next_cursor;
            if cursor == 0 {
                break;
            }
        }

        Ok(count)
    }

    pub fn claim_execution(&self, job_id: &str, worker_id: &str) -> Result<bool> {
        let mut conn = self.conn()?;
        let now = now_millis();
        let ckey = self.key(&["exec_claim", job_id]);
        let index_key = self.key(&["exec_claims", "by_time"]);

        // NX: set only if not exists. PX: auto-expire after 24 hours so
        // orphaned claims from dead workers don't block re-execution forever.
        let acquired: bool = redis::cmd("SET")
            .arg(&ckey)
            .arg(format!("{worker_id}:{now}"))
            .arg("NX")
            .arg("PX")
            .arg(86_400_000i64) // 24 hours in milliseconds
            .query(&mut conn)
            .map_err(map_err)?;

        if acquired {
            // Mirror the claim into a time-indexed sorted set so the
            // scheduler's maintenance loop can purge stale claims with an
            // O(log n) range query.
            conn.zadd::<_, _, _, ()>(&index_key, job_id, now as f64)
                .map_err(map_err)?;
        }

        Ok(acquired)
    }

    pub fn complete_execution(&self, job_id: &str) -> Result<()> {
        let mut conn = self.conn()?;
        let ckey = self.key(&["exec_claim", job_id]);
        let index_key = self.key(&["exec_claims", "by_time"]);

        let pipe = &mut redis::pipe();
        pipe.del(&ckey);
        pipe.zrem(&index_key, job_id);
        pipe.query::<()>(&mut conn).map_err(map_err)?;

        Ok(())
    }

    pub fn purge_execution_claims(&self, older_than_ms: i64) -> Result<u64> {
        let mut conn = self.conn()?;
        let index_key = self.key(&["exec_claims", "by_time"]);

        // Find all claims with `claimed_at <= older_than_ms`.
        let expired_ids: Vec<String> = conn
            .zrangebyscore(&index_key, "-inf", older_than_ms as f64)
            .map_err(map_err)?;

        if expired_ids.is_empty() {
            return Ok(0);
        }

        let pipe = &mut redis::pipe();
        for id in &expired_ids {
            let ckey = self.key(&["exec_claim", id]);
            pipe.del(&ckey);
            pipe.zrem(&index_key, id);
        }
        pipe.query::<()>(&mut conn).map_err(map_err)?;

        Ok(expired_ids.len() as u64)
    }
}
