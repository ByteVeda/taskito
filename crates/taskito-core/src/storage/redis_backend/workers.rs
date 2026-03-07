use redis::Commands;

use super::{map_err, RedisStorage};
use crate::error::Result;
use crate::job::now_millis;
use crate::storage::models::WorkerRow;

const DEAD_WORKER_THRESHOLD_MS: i64 = 30_000;

impl RedisStorage {
    pub fn register_worker(&self, worker_id: &str, queues: &str, tags: Option<&str>) -> Result<()> {
        let mut conn = self.conn()?;
        let now = now_millis();
        let wkey = self.key(&["worker", worker_id]);
        let wall = self.key(&["workers", "all"]);

        let pipe = &mut redis::pipe();
        pipe.hset(&wkey, "last_heartbeat", now);
        pipe.hset(&wkey, "queues", queues);
        pipe.hset(&wkey, "status", "active");
        pipe.hset(&wkey, "tags", tags.unwrap_or(""));
        pipe.sadd(&wall, worker_id);
        pipe.query::<()>(&mut conn).map_err(map_err)?;

        Ok(())
    }

    pub fn heartbeat(&self, worker_id: &str) -> Result<()> {
        let mut conn = self.conn()?;
        let now = now_millis();
        let wkey = self.key(&["worker", worker_id]);

        conn.hset::<_, _, _, ()>(&wkey, "last_heartbeat", now)
            .map_err(map_err)?;

        Ok(())
    }

    pub fn list_workers(&self) -> Result<Vec<WorkerRow>> {
        let mut conn = self.conn()?;
        let wall = self.key(&["workers", "all"]);

        let worker_ids: Vec<String> = conn.smembers(&wall).map_err(map_err)?;

        let mut rows = Vec::new();
        for wid in worker_ids {
            let wkey = self.key(&["worker", &wid]);
            let data: std::collections::HashMap<String, String> =
                conn.hgetall(&wkey).map_err(map_err)?;

            if data.is_empty() {
                continue;
            }

            let tags_val = data.get("tags").map(|s| s.as_str()).unwrap_or("");

            rows.push(WorkerRow {
                worker_id: wid,
                last_heartbeat: data
                    .get("last_heartbeat")
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(0),
                queues: data
                    .get("queues")
                    .cloned()
                    .unwrap_or_else(|| "default".to_string()),
                status: data
                    .get("status")
                    .cloned()
                    .unwrap_or_else(|| "active".to_string()),
                tags: if tags_val.is_empty() {
                    None
                } else {
                    Some(tags_val.to_string())
                },
            });
        }

        Ok(rows)
    }

    pub fn reap_dead_workers(&self) -> Result<u64> {
        let mut conn = self.conn()?;
        let cutoff = now_millis().saturating_sub(DEAD_WORKER_THRESHOLD_MS);
        let wall = self.key(&["workers", "all"]);

        let worker_ids: Vec<String> = conn.smembers(&wall).map_err(map_err)?;

        let mut count = 0u64;
        for wid in worker_ids {
            let wkey = self.key(&["worker", &wid]);
            let hb: Option<i64> = conn.hget(&wkey, "last_heartbeat").map_err(map_err)?;

            if let Some(last_hb) = hb {
                if last_hb < cutoff {
                    let pipe = &mut redis::pipe();
                    pipe.del(&wkey);
                    pipe.srem(&wall, &wid);
                    pipe.query::<()>(&mut conn).map_err(map_err)?;
                    count += 1;
                }
            } else {
                // No heartbeat data — remove
                let pipe = &mut redis::pipe();
                pipe.del(&wkey);
                pipe.srem(&wall, &wid);
                pipe.query::<()>(&mut conn).map_err(map_err)?;
                count += 1;
            }
        }

        Ok(count)
    }

    pub fn unregister_worker(&self, worker_id: &str) -> Result<()> {
        let mut conn = self.conn()?;
        let wkey = self.key(&["worker", worker_id]);
        let wall = self.key(&["workers", "all"]);

        let pipe = &mut redis::pipe();
        pipe.del(&wkey);
        pipe.srem(&wall, worker_id);
        pipe.query::<()>(&mut conn).map_err(map_err)?;

        Ok(())
    }
}
