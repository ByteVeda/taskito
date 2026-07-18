//! Job error history: record, fetch, purge.

use redis::Commands;

use crate::error::{QueueError, Result};
use crate::job::now_millis;
use crate::storage::records::JobError;
use crate::storage::redis_backend::{map_err, RedisStorage};

impl RedisStorage {
    pub fn record_error(&self, job_id: &str, attempt: i32, error: &str) -> Result<()> {
        let mut conn = self.conn()?;
        let id = uuid::Uuid::now_v7().to_string();
        let now = now_millis();

        let row = JobError {
            id: id.clone(),
            job_id: job_id.to_string(),
            attempt,
            error: error.to_string(),
            failed_at: now,
        };
        let json = serde_json::to_string(&row).map_err(|e| QueueError::Other(e.to_string()))?;

        let errors_key = self.key(&["job_errors", job_id]);
        conn.rpush::<_, _, ()>(&errors_key, &json)
            .map_err(map_err)?;

        Ok(())
    }

    pub fn get_job_errors(&self, job_id: &str) -> Result<Vec<JobError>> {
        let mut conn = self.conn()?;
        let errors_key = self.key(&["job_errors", job_id]);
        let entries: Vec<String> = conn.lrange(&errors_key, 0, -1).map_err(map_err)?;

        let mut rows = Vec::new();
        for entry in entries {
            let row: JobError =
                serde_json::from_str(&entry).map_err(|e| QueueError::Other(e.to_string()))?;
            rows.push(row);
        }
        rows.sort_by_key(|r| r.attempt);
        Ok(rows)
    }

    pub fn purge_job_errors(&self, older_than_ms: i64) -> Result<u64> {
        let mut conn = self.conn()?;
        // Scan for all job_errors keys
        let pattern = self.key(&["job_errors", "*"]);
        let mut keys: Vec<String> = Vec::new();
        let mut cursor = 0u64;
        loop {
            let (next_cursor, batch): (u64, Vec<String>) = redis::cmd("SCAN")
                .arg(cursor)
                .arg("MATCH")
                .arg(&pattern)
                .arg("COUNT")
                .arg(100)
                .query(&mut conn)
                .map_err(map_err)?;
            keys.extend(batch);
            cursor = next_cursor;
            if cursor == 0 {
                break;
            }
        }

        let mut count = 0u64;
        for key in keys {
            let entries: Vec<String> = conn.lrange(&key, 0, -1).map_err(map_err)?;
            let mut to_keep = Vec::new();
            for entry in &entries {
                if let Ok(row) = serde_json::from_str::<JobError>(entry) {
                    if row.failed_at >= older_than_ms {
                        to_keep.push(entry.clone());
                    } else {
                        count += 1;
                    }
                }
            }
            if to_keep.len() < entries.len() {
                let pipe = &mut redis::pipe();
                pipe.del(&key);
                for item in &to_keep {
                    pipe.rpush(&key, item);
                }
                pipe.query::<()>(&mut conn).map_err(map_err)?;
            }
        }

        Ok(count)
    }
}
