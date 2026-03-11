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

        let keys: Vec<String> = redis::cmd("KEYS")
            .arg(&pattern)
            .query(&mut conn)
            .map_err(map_err)?;

        let mut count = 0u64;
        for key in keys {
            let expires_at: Option<i64> = conn.hget(&key, "expires_at").map_err(map_err)?;
            if let Some(exp) = expires_at {
                if exp <= now {
                    conn.del::<_, ()>(&key).map_err(map_err)?;
                    count += 1;
                }
            }
        }

        Ok(count)
    }

    pub fn claim_execution(&self, job_id: &str, worker_id: &str) -> Result<bool> {
        let mut conn = self.conn()?;
        let now = now_millis();
        let ckey = self.key(&["exec_claim", job_id]);

        // NX: set only if not exists
        let result: bool = redis::cmd("SET")
            .arg(&ckey)
            .arg(format!("{worker_id}:{now}"))
            .arg("NX")
            .query(&mut conn)
            .map_err(map_err)?;

        Ok(result)
    }

    pub fn complete_execution(&self, job_id: &str) -> Result<()> {
        let mut conn = self.conn()?;
        let ckey = self.key(&["exec_claim", job_id]);

        conn.del::<_, ()>(&ckey).map_err(map_err)?;

        Ok(())
    }

    pub fn purge_execution_claims(&self, _older_than_ms: i64) -> Result<u64> {
        // Redis doesn't have efficient timestamp-based scanning for simple keys.
        // For production use, execution claims should use TTL on the key itself.
        // For now, this is a no-op — claims are cleaned up on complete_execution.
        Ok(0)
    }
}
