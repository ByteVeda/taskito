use redis::Commands;
use serde::{Deserialize, Serialize};

use super::{map_err, RedisStorage};
use crate::error::{QueueError, Result};
use crate::storage::models::{NewPeriodicTaskRow, PeriodicTaskRow};

#[derive(Serialize, Deserialize)]
struct PeriodicEntry {
    pub name: String,
    pub task_name: String,
    pub cron_expr: String,
    pub args: Option<Vec<u8>>,
    pub kwargs: Option<Vec<u8>>,
    pub queue: String,
    pub enabled: bool,
    pub last_run: Option<i64>,
    pub next_run: i64,
    pub timezone: Option<String>,
}

impl From<PeriodicEntry> for PeriodicTaskRow {
    fn from(e: PeriodicEntry) -> Self {
        Self {
            name: e.name,
            task_name: e.task_name,
            cron_expr: e.cron_expr,
            args: e.args,
            kwargs: e.kwargs,
            queue: e.queue,
            enabled: e.enabled,
            last_run: e.last_run,
            next_run: e.next_run,
            timezone: e.timezone,
        }
    }
}

impl RedisStorage {
    pub fn register_periodic(&self, task: &NewPeriodicTaskRow) -> Result<()> {
        let mut conn = self.conn()?;

        let entry = PeriodicEntry {
            name: task.name.to_string(),
            task_name: task.task_name.to_string(),
            cron_expr: task.cron_expr.to_string(),
            args: task.args.map(|a| a.to_vec()),
            kwargs: task.kwargs.map(|k| k.to_vec()),
            queue: task.queue.to_string(),
            enabled: task.enabled,
            last_run: None,
            next_run: task.next_run,
            timezone: task.timezone.map(|s| s.to_string()),
        };

        let json = serde_json::to_string(&entry).map_err(|e| QueueError::Other(e.to_string()))?;

        let pkey = self.key(&["periodic", task.name]);
        let due_key = self.key(&["periodic", "due"]);

        let pipe = &mut redis::pipe();
        pipe.set(&pkey, &json);
        if entry.enabled {
            pipe.zadd(&due_key, task.name, task.next_run as f64);
        }
        pipe.query::<()>(&mut conn).map_err(map_err)?;

        Ok(())
    }

    pub fn get_due_periodic(&self, now: i64) -> Result<Vec<PeriodicTaskRow>> {
        let mut conn = self.conn()?;
        let due_key = self.key(&["periodic", "due"]);

        let names: Vec<String> = conn
            .zrangebyscore(&due_key, "-inf", now as f64)
            .map_err(map_err)?;

        let mut rows = Vec::new();
        for name in names {
            let pkey = self.key(&["periodic", &name]);
            let data: Option<String> = conn.get(&pkey).map_err(map_err)?;
            if let Some(d) = data {
                let entry: PeriodicEntry =
                    serde_json::from_str(&d).map_err(|e| QueueError::Other(e.to_string()))?;
                if entry.enabled {
                    rows.push(PeriodicTaskRow::from(entry));
                }
            }
        }

        Ok(rows)
    }

    pub fn update_periodic_schedule(&self, name: &str, last_run: i64, next_run: i64) -> Result<()> {
        let mut conn = self.conn()?;
        let pkey = self.key(&["periodic", name]);

        let data: Option<String> = conn.get(&pkey).map_err(map_err)?;
        if let Some(d) = data {
            let mut entry: PeriodicEntry =
                serde_json::from_str(&d).map_err(|e| QueueError::Other(e.to_string()))?;
            entry.last_run = Some(last_run);
            entry.next_run = next_run;

            let json =
                serde_json::to_string(&entry).map_err(|e| QueueError::Other(e.to_string()))?;

            let due_key = self.key(&["periodic", "due"]);
            let pipe = &mut redis::pipe();
            pipe.set(&pkey, &json);
            pipe.zadd(&due_key, name, next_run as f64);
            pipe.query::<()>(&mut conn).map_err(map_err)?;
        }

        Ok(())
    }
}
