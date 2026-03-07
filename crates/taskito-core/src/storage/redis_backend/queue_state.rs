use redis::Commands;

use super::{map_err, RedisStorage};
use crate::error::Result;

impl RedisStorage {
    pub fn pause_queue(&self, queue_name: &str) -> Result<()> {
        let mut conn = self.conn()?;
        let paused_key = self.key(&["queues", "paused"]);
        conn.sadd::<_, _, ()>(&paused_key, queue_name)
            .map_err(map_err)?;
        Ok(())
    }

    pub fn resume_queue(&self, queue_name: &str) -> Result<()> {
        let mut conn = self.conn()?;
        let paused_key = self.key(&["queues", "paused"]);
        conn.srem::<_, _, ()>(&paused_key, queue_name)
            .map_err(map_err)?;
        Ok(())
    }

    pub fn list_paused_queues(&self) -> Result<Vec<String>> {
        let mut conn = self.conn()?;
        let paused_key = self.key(&["queues", "paused"]);
        let names: Vec<String> = conn.smembers(&paused_key).map_err(map_err)?;
        Ok(names)
    }
}
