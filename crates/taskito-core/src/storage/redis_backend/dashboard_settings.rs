use std::collections::HashMap;

use redis::Commands;

use super::{map_err, RedisStorage};
use crate::error::Result;

/// Redis key for the dashboard settings hash. All keys are stored under
/// a single hash so atomic ``HGETALL`` returns the full snapshot.
fn settings_key(storage: &RedisStorage) -> String {
    storage.key(&["dashboard", "settings"])
}

impl RedisStorage {
    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let mut conn = self.conn()?;
        let value: Option<String> = conn.hget(settings_key(self), key).map_err(map_err)?;
        Ok(value)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        let mut conn = self.conn()?;
        conn.hset::<_, _, _, ()>(settings_key(self), key, value)
            .map_err(map_err)?;
        Ok(())
    }

    pub fn delete_setting(&self, key: &str) -> Result<bool> {
        let mut conn = self.conn()?;
        let removed: i64 = conn.hdel(settings_key(self), key).map_err(map_err)?;
        Ok(removed > 0)
    }

    pub fn list_settings(&self) -> Result<HashMap<String, String>> {
        let mut conn = self.conn()?;
        let map: HashMap<String, String> = conn.hgetall(settings_key(self)).map_err(map_err)?;
        Ok(map)
    }
}
