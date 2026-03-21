use redis::Commands;

use super::{map_err, RedisStorage};
use crate::error::Result;
use crate::job::now_millis;
use crate::storage::models::WorkerRow;

const DEAD_WORKER_THRESHOLD_MS: i64 = 30_000;

impl RedisStorage {
    #[allow(clippy::too_many_arguments)]
    pub fn register_worker(
        &self,
        worker_id: &str,
        queues: &str,
        tags: Option<&str>,
        resources: Option<&str>,
        resource_health: Option<&str>,
        threads: i32,
        hostname: Option<&str>,
        pid: Option<i32>,
        pool_type: Option<&str>,
    ) -> Result<()> {
        let mut conn = self.conn()?;
        let now = now_millis();
        let wkey = self.key(&["worker", worker_id]);
        let wall = self.key(&["workers", "all"]);

        let pipe = &mut redis::pipe();
        pipe.hset(&wkey, "last_heartbeat", now);
        pipe.hset(&wkey, "queues", queues);
        pipe.hset(&wkey, "status", "active");
        pipe.hset(&wkey, "tags", tags.unwrap_or(""));
        pipe.hset(&wkey, "resources", resources.unwrap_or(""));
        pipe.hset(&wkey, "resource_health", resource_health.unwrap_or(""));
        pipe.hset(&wkey, "threads", threads);
        pipe.hset(&wkey, "started_at", now);
        pipe.hset(&wkey, "hostname", hostname.unwrap_or(""));
        pipe.hset(&wkey, "pid", pid.unwrap_or(0));
        pipe.hset(&wkey, "pool_type", pool_type.unwrap_or(""));
        pipe.sadd(&wall, worker_id);
        pipe.query::<()>(&mut conn).map_err(map_err)?;

        Ok(())
    }

    pub fn heartbeat(&self, worker_id: &str, resource_health: Option<&str>) -> Result<()> {
        let mut conn = self.conn()?;
        let now = now_millis();
        let wkey = self.key(&["worker", worker_id]);

        let pipe = &mut redis::pipe();
        pipe.hset(&wkey, "last_heartbeat", now);
        pipe.hset(&wkey, "resource_health", resource_health.unwrap_or(""));
        pipe.query::<()>(&mut conn).map_err(map_err)?;

        Ok(())
    }

    pub fn update_worker_status(&self, worker_id: &str, status: &str) -> Result<()> {
        let mut conn = self.conn()?;
        let wkey = self.key(&["worker", worker_id]);

        conn.hset::<_, _, _, ()>(&wkey, "status", status)
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

            let to_opt =
                |key: &str| -> Option<String> { data.get(key).filter(|s| !s.is_empty()).cloned() };

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
                tags: to_opt("tags"),
                resources: to_opt("resources"),
                resource_health: to_opt("resource_health"),
                threads: data
                    .get("threads")
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(0),
                started_at: data.get("started_at").and_then(|s| s.parse().ok()),
                hostname: to_opt("hostname"),
                pid: data
                    .get("pid")
                    .and_then(|s| s.parse().ok())
                    .filter(|&v: &i32| v != 0),
                pool_type: to_opt("pool_type"),
            });
        }

        Ok(rows)
    }

    pub fn reap_dead_workers(&self) -> Result<Vec<String>> {
        let mut conn = self.conn()?;
        let cutoff = now_millis().saturating_sub(DEAD_WORKER_THRESHOLD_MS);
        let wall = self.key(&["workers", "all"]);

        let worker_ids: Vec<String> = conn.smembers(&wall).map_err(map_err)?;

        let mut reaped = Vec::new();
        for wid in worker_ids {
            let wkey = self.key(&["worker", &wid]);
            let hb: Option<i64> = conn.hget(&wkey, "last_heartbeat").map_err(map_err)?;

            let is_dead = match hb {
                Some(last_hb) => last_hb < cutoff,
                None => true,
            };

            if is_dead {
                let pipe = &mut redis::pipe();
                pipe.del(&wkey);
                pipe.srem(&wall, &wid);
                pipe.query::<()>(&mut conn).map_err(map_err)?;
                reaped.push(wid);
            }
        }

        Ok(reaped)
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

    pub fn list_claims_by_worker(&self, worker_id: &str) -> Result<Vec<String>> {
        let mut conn = self.conn()?;
        let pattern = self.key(&["exec_claim", "*"]);

        let mut job_ids = Vec::new();
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
                let value: Option<String> = conn.get(&key).map_err(map_err)?;
                if let Some(val) = value {
                    // Value format is "{worker_id}:{timestamp}"
                    if val.starts_with(worker_id) && val[worker_id.len()..].starts_with(':') {
                        // Extract job_id from key: "{prefix}exec_claim:{job_id}"
                        let prefix = self.key(&["exec_claim", ""]);
                        if let Some(job_id) = key.strip_prefix(&prefix) {
                            job_ids.push(job_id.to_string());
                        }
                    }
                }
            }

            cursor = next_cursor;
            if cursor == 0 {
                break;
            }
        }

        Ok(job_ids)
    }
}
