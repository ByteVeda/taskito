use crate::error::Result;
use crate::job::Job;
use crate::storage::sqlite::{DeadJob, SqliteStorage};

/// Dead letter queue manager.
pub struct DeadLetterQueue {
    storage: SqliteStorage,
}

impl DeadLetterQueue {
    pub fn new(storage: SqliteStorage) -> Self {
        Self { storage }
    }

    /// Move a failed job to the dead letter queue.
    pub fn move_to_dlq(&self, job: &Job, error: &str, metadata: Option<&str>) -> Result<()> {
        self.storage.move_to_dlq(job, error, metadata)
    }

    /// List dead letter entries.
    pub fn list(&self, limit: i64, offset: i64) -> Result<Vec<DeadJob>> {
        self.storage.list_dead(limit, offset)
    }

    /// Re-enqueue a dead letter job. Returns the new job ID.
    pub fn retry(&self, dead_id: &str) -> Result<String> {
        self.storage.retry_dead(dead_id)
    }

    /// Purge dead letter entries older than the given number of milliseconds ago.
    pub fn purge(&self, older_than_ms: i64) -> Result<u64> {
        self.storage.purge_dead(older_than_ms)
    }
}
