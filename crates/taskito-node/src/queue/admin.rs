//! Management (mutating) methods on `JsQueue`.

use napi::bindgen_prelude::Result;
use napi_derive::napi;
use taskito_core::Storage;

use super::JsQueue;
use crate::convert::{dead_job_to_js, JsDeadJob};
use crate::error::{non_negative, to_napi_err};

const DEFAULT_LIMIT: i64 = 50;

#[napi]
impl JsQueue {
    /// List dead-letter entries (paginated).
    #[napi]
    pub fn dead_letters(&self, limit: Option<i64>, offset: Option<i64>) -> Result<Vec<JsDeadJob>> {
        let limit = non_negative(limit.unwrap_or(DEFAULT_LIMIT), "limit")?;
        let offset = non_negative(offset.unwrap_or(0), "offset")?;
        let dead = self.storage.list_dead(limit, offset).map_err(to_napi_err)?;
        Ok(dead.into_iter().map(dead_job_to_js).collect())
    }

    /// Re-enqueue a dead-letter entry. Returns the new job id.
    #[napi]
    pub fn retry_dead(&self, dead_id: String) -> Result<String> {
        self.storage.retry_dead(&dead_id).map_err(to_napi_err)
    }

    /// Delete a dead-letter entry. Returns false if it didn't exist.
    #[napi]
    pub fn delete_dead(&self, dead_id: String) -> Result<bool> {
        self.storage.delete_dead(&dead_id).map_err(to_napi_err)
    }

    /// Purge dead-letter entries older than `older_than_ms`. Returns the count removed.
    #[napi]
    pub fn purge_dead(&self, older_than_ms: i64) -> Result<i64> {
        let older_than_ms = non_negative(older_than_ms, "olderThanMs")?;
        self.storage
            .purge_dead(older_than_ms)
            .map(|n| n as i64)
            .map_err(to_napi_err)
    }

    /// Purge completed jobs older than `older_than_ms`. Returns the count removed.
    #[napi]
    pub fn purge_completed(&self, older_than_ms: i64) -> Result<i64> {
        let older_than_ms = non_negative(older_than_ms, "olderThanMs")?;
        self.storage
            .purge_completed(older_than_ms)
            .map(|n| n as i64)
            .map_err(to_napi_err)
    }

    /// Pause a queue — workers stop dispatching its jobs until resumed.
    #[napi]
    pub fn pause_queue(&self, queue: String) -> Result<()> {
        self.storage.pause_queue(&queue).map_err(to_napi_err)
    }

    /// Resume a paused queue.
    #[napi]
    pub fn resume_queue(&self, queue: String) -> Result<()> {
        self.storage.resume_queue(&queue).map_err(to_napi_err)
    }

    /// List the names of currently-paused queues.
    #[napi]
    pub fn list_paused_queues(&self) -> Result<Vec<String>> {
        self.storage.list_paused_queues().map_err(to_napi_err)
    }
}
