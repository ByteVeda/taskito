use redis::Commands;
use serde::{Deserialize, Serialize};

use super::{map_err, RedisStorage};
use crate::error::{QueueError, Result};
use crate::job::now_millis;
use crate::storage::models::TaskLogRow;

#[derive(Serialize, Deserialize)]
struct LogEntry {
    pub id: String,
    pub job_id: String,
    pub task_name: String,
    pub level: String,
    pub message: String,
    pub extra: Option<String>,
    pub logged_at: i64,
}

impl From<LogEntry> for TaskLogRow {
    fn from(e: LogEntry) -> Self {
        Self {
            id: e.id,
            job_id: e.job_id,
            task_name: e.task_name,
            level: e.level,
            message: e.message,
            extra: e.extra,
            logged_at: e.logged_at,
        }
    }
}

impl RedisStorage {
    pub fn write_task_log(
        &self,
        job_id: &str,
        task_name: &str,
        level: &str,
        message: &str,
        extra: Option<&str>,
    ) -> Result<()> {
        let mut conn = self.conn()?;
        let id = uuid::Uuid::now_v7().to_string();
        let now = now_millis();

        let entry = LogEntry {
            id: id.clone(),
            job_id: job_id.to_string(),
            task_name: task_name.to_string(),
            level: level.to_string(),
            message: message.to_string(),
            extra: extra.map(|s| s.to_string()),
            logged_at: now,
        };

        let json = serde_json::to_string(&entry).map_err(|e| QueueError::Other(e.to_string()))?;

        let log_key = self.key(&["log", &id]);
        let by_job_key = self.key(&["logs", "by_job", job_id]);
        let all_key = self.key(&["logs", "all"]);

        let pipe = &mut redis::pipe();
        pipe.set(&log_key, &json);
        pipe.zadd(&by_job_key, &id, now as f64);
        pipe.zadd(&all_key, &id, now as f64);
        pipe.query::<()>(&mut conn).map_err(map_err)?;

        Ok(())
    }

    pub fn get_task_logs(&self, job_id: &str) -> Result<Vec<TaskLogRow>> {
        let mut conn = self.conn()?;
        let by_job_key = self.key(&["logs", "by_job", job_id]);

        let ids: Vec<String> = conn
            .zrangebyscore(&by_job_key, "-inf", "+inf")
            .map_err(map_err)?;

        let mut rows = Vec::new();
        for id in ids {
            let log_key = self.key(&["log", &id]);
            let data: Option<String> = conn.get(&log_key).map_err(map_err)?;
            if let Some(d) = data {
                let entry: LogEntry =
                    serde_json::from_str(&d).map_err(|e| QueueError::Other(e.to_string()))?;
                rows.push(TaskLogRow::from(entry));
            }
        }

        // Sort by logged_at asc
        rows.sort_by_key(|r| r.logged_at);
        Ok(rows)
    }

    pub fn query_task_logs(
        &self,
        task_name: Option<&str>,
        level: Option<&str>,
        since_ms: i64,
        limit: i64,
    ) -> Result<Vec<TaskLogRow>> {
        let mut conn = self.conn()?;
        let all_key = self.key(&["logs", "all"]);

        let ids: Vec<String> = conn
            .zrangebyscore(&all_key, since_ms as f64, "+inf")
            .map_err(map_err)?;

        let mut rows = Vec::new();
        for id in ids {
            let log_key = self.key(&["log", &id]);
            let data: Option<String> = conn.get(&log_key).map_err(map_err)?;
            if let Some(d) = data {
                let entry: LogEntry =
                    serde_json::from_str(&d).map_err(|e| QueueError::Other(e.to_string()))?;

                if let Some(n) = task_name {
                    if entry.task_name != n {
                        continue;
                    }
                }
                if let Some(l) = level {
                    if entry.level != l {
                        continue;
                    }
                }

                rows.push(TaskLogRow::from(entry));
            }
        }

        // Sort by logged_at desc
        rows.sort_by(|a, b| b.logged_at.cmp(&a.logged_at));
        rows.truncate(limit as usize);
        Ok(rows)
    }

    pub fn purge_task_logs(&self, older_than_ms: i64) -> Result<u64> {
        let mut conn = self.conn()?;
        let all_key = self.key(&["logs", "all"]);

        let ids: Vec<String> = conn
            .zrangebyscore(&all_key, "-inf", older_than_ms as f64)
            .map_err(map_err)?;

        if ids.is_empty() {
            return Ok(0);
        }

        let pipe = &mut redis::pipe();
        for id in &ids {
            let log_key = self.key(&["log", id]);
            // Load to get job_id for by_job cleanup
            let data: Option<String> = conn.get(&log_key).map_err(map_err)?;
            if let Some(d) = data {
                if let Ok(entry) = serde_json::from_str::<LogEntry>(&d) {
                    let by_job_key = self.key(&["logs", "by_job", &entry.job_id]);
                    pipe.zrem(&by_job_key, id);
                }
            }
            pipe.del(&log_key);
            pipe.zrem(&all_key, id);
        }
        pipe.query::<()>(&mut conn).map_err(map_err)?;

        Ok(ids.len() as u64)
    }
}
