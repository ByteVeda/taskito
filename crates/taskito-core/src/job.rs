use serde::{Deserialize, Serialize};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use uuid::Uuid;

use crate::storage::models::{ArchivedJobRow, JobRow, NarrowArchivedJobRow, NarrowJobRow};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(i32)]
pub enum JobStatus {
    Pending = 0,
    Running = 1,
    Complete = 2,
    Failed = 3,
    Dead = 4,
    Cancelled = 5,
}

impl JobStatus {
    pub fn from_i32(v: i32) -> Option<Self> {
        match v {
            0 => Some(Self::Pending),
            1 => Some(Self::Running),
            2 => Some(Self::Complete),
            3 => Some(Self::Failed),
            4 => Some(Self::Dead),
            5 => Some(Self::Cancelled),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Running => "running",
            Self::Complete => "complete",
            Self::Failed => "failed",
            Self::Dead => "dead",
            Self::Cancelled => "cancelled",
        }
    }

    /// Canonical name used by `serde` when this enum is serialized to JSON.
    ///
    /// Backends that decode `Job` JSON in non-Rust contexts (e.g. the Redis
    /// backend's Lua scripts) must compare against this exact value rather
    /// than the `#[repr(i32)]` discriminant — `serde_derive` emits the
    /// variant name, not the integer. The `serde_name_matches_serde_output`
    /// test guards the contract.
    pub const fn wire_name(self) -> &'static str {
        match self {
            Self::Pending => "Pending",
            Self::Running => "Running",
            Self::Complete => "Complete",
            Self::Failed => "Failed",
            Self::Dead => "Dead",
            Self::Cancelled => "Cancelled",
        }
    }
}

/// A job stored in the queue.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Job {
    pub id: String,
    pub queue: String,
    pub task_name: String,
    pub payload: Vec<u8>,
    pub status: JobStatus,
    pub priority: i32,
    pub created_at: i64,
    pub scheduled_at: i64,
    pub started_at: Option<i64>,
    pub completed_at: Option<i64>,
    pub retry_count: i32,
    pub max_retries: i32,
    pub result: Option<Vec<u8>>,
    pub error: Option<String>,
    pub timeout_ms: i64,
    pub unique_key: Option<String>,
    pub progress: Option<i32>,
    pub metadata: Option<String>,
    /// Structured, user-readable annotations attached to the job (canonical
    /// JSON object, ≤ 15 top-level fields). Validated at the binding
    /// boundary (e.g. `taskito.notes.validate_and_encode_notes` in the Python
    /// shell); stored as the already-encoded JSON string here.
    #[serde(default)]
    pub notes: Option<String>,
    pub cancel_requested: bool,
    pub expires_at: Option<i64>,
    pub result_ttl_ms: Option<i64>,
    pub namespace: Option<String>,
    /// True when the job was enqueued with at least one dependency. Lets the
    /// scheduler skip the dependency lookup entirely for the common case.
    #[serde(default)]
    pub has_deps: bool,
}

impl From<JobRow> for Job {
    fn from(row: JobRow) -> Self {
        Self {
            id: row.id,
            queue: row.queue,
            task_name: row.task_name,
            payload: row.payload,
            status: JobStatus::from_i32(row.status).unwrap_or(JobStatus::Pending),
            priority: row.priority,
            created_at: row.created_at,
            scheduled_at: row.scheduled_at,
            started_at: row.started_at,
            completed_at: row.completed_at,
            retry_count: row.retry_count,
            max_retries: row.max_retries,
            result: row.result,
            error: row.error,
            timeout_ms: row.timeout_ms,
            unique_key: row.unique_key,
            progress: row.progress,
            metadata: row.metadata,
            notes: row.notes,
            cancel_requested: row.cancel_requested != 0,
            expires_at: row.expires_at,
            result_ttl_ms: row.result_ttl_ms,
            namespace: row.namespace,
            has_deps: row.has_deps,
        }
    }
}

impl From<ArchivedJobRow> for Job {
    fn from(row: ArchivedJobRow) -> Self {
        Self {
            id: row.id,
            queue: row.queue,
            task_name: row.task_name,
            payload: row.payload,
            status: JobStatus::from_i32(row.status).unwrap_or(JobStatus::Pending),
            priority: row.priority,
            created_at: row.created_at,
            scheduled_at: row.scheduled_at,
            started_at: row.started_at,
            completed_at: row.completed_at,
            retry_count: row.retry_count,
            max_retries: row.max_retries,
            result: row.result,
            error: row.error,
            timeout_ms: row.timeout_ms,
            unique_key: row.unique_key,
            progress: row.progress,
            metadata: row.metadata,
            notes: row.notes,
            cancel_requested: row.cancel_requested != 0,
            expires_at: row.expires_at,
            result_ttl_ms: row.result_ttl_ms,
            namespace: row.namespace,
            // Archived jobs are terminal and never re-dequeued.
            has_deps: false,
        }
    }
}

impl Job {
    /// Assemble a [`Job`] from a blob-free [`NarrowJobRow`] plus `payload`/
    /// `result` supplied by the caller. The narrow row carries every non-blob
    /// column; reap/listing paths that don't need the blobs pass empty ones.
    pub fn from_narrow(narrow: NarrowJobRow, payload: Vec<u8>, result: Option<Vec<u8>>) -> Self {
        Self {
            id: narrow.id,
            queue: narrow.queue,
            task_name: narrow.task_name,
            payload,
            status: JobStatus::from_i32(narrow.status).unwrap_or(JobStatus::Pending),
            priority: narrow.priority,
            created_at: narrow.created_at,
            scheduled_at: narrow.scheduled_at,
            started_at: narrow.started_at,
            completed_at: narrow.completed_at,
            retry_count: narrow.retry_count,
            max_retries: narrow.max_retries,
            result,
            error: narrow.error,
            timeout_ms: narrow.timeout_ms,
            unique_key: narrow.unique_key,
            progress: narrow.progress,
            metadata: narrow.metadata,
            notes: narrow.notes,
            cancel_requested: narrow.cancel_requested != 0,
            expires_at: narrow.expires_at,
            result_ttl_ms: narrow.result_ttl_ms,
            namespace: narrow.namespace,
            has_deps: narrow.has_deps,
        }
    }

    /// Assemble a terminal [`Job`] from a blob-free [`NarrowArchivedJobRow`].
    /// Listing paths use this so paging the archive never loads `payload`/
    /// `result`; both come back empty (fetch the full job via `get_job`).
    /// Archived jobs are terminal and never re-dequeued, so `has_deps` is false.
    pub fn from_narrow_archived(narrow: NarrowArchivedJobRow) -> Self {
        Self {
            id: narrow.id,
            queue: narrow.queue,
            task_name: narrow.task_name,
            payload: Vec::new(),
            status: JobStatus::from_i32(narrow.status).unwrap_or(JobStatus::Pending),
            priority: narrow.priority,
            created_at: narrow.created_at,
            scheduled_at: narrow.scheduled_at,
            started_at: narrow.started_at,
            completed_at: narrow.completed_at,
            retry_count: narrow.retry_count,
            max_retries: narrow.max_retries,
            result: None,
            error: narrow.error,
            timeout_ms: narrow.timeout_ms,
            unique_key: narrow.unique_key,
            progress: narrow.progress,
            metadata: narrow.metadata,
            notes: narrow.notes,
            cancel_requested: narrow.cancel_requested != 0,
            expires_at: narrow.expires_at,
            result_ttl_ms: narrow.result_ttl_ms,
            namespace: narrow.namespace,
            has_deps: false,
        }
    }
}

/// A successful job outcome to persist. Batches the three writes the success
/// path makes per job — archive the completed job, clear its execution claim,
/// record its metric — so [`Storage::complete_batch`] can commit many at once.
///
/// [`Storage::complete_batch`]: crate::storage::Storage::complete_batch
pub struct JobCompletion {
    pub job_id: String,
    pub result: Option<Vec<u8>>,
    pub task_name: String,
    pub wall_time_ns: i64,
}

/// Parameters for creating a new job.
pub struct NewJob {
    pub queue: String,
    pub task_name: String,
    pub payload: Vec<u8>,
    pub priority: i32,
    pub scheduled_at: i64,
    pub max_retries: i32,
    pub timeout_ms: i64,
    pub unique_key: Option<String>,
    pub metadata: Option<String>,
    /// Pre-encoded canonical JSON object (≤ 15 fields). See [`Job::notes`].
    pub notes: Option<String>,
    pub depends_on: Vec<String>,
    pub expires_at: Option<i64>,
    pub result_ttl_ms: Option<i64>,
    pub namespace: Option<String>,
}

impl NewJob {
    pub fn into_job(self) -> Job {
        let now = now_millis();
        let has_deps = !self.depends_on.is_empty();
        Job {
            id: Uuid::now_v7().to_string(),
            queue: self.queue,
            task_name: self.task_name,
            payload: self.payload,
            status: JobStatus::Pending,
            priority: self.priority,
            created_at: now,
            scheduled_at: self.scheduled_at,
            started_at: None,
            completed_at: None,
            retry_count: 0,
            max_retries: self.max_retries,
            result: None,
            error: None,
            timeout_ms: self.timeout_ms,
            unique_key: self.unique_key,
            progress: None,
            metadata: self.metadata,
            notes: self.notes,
            cancel_requested: false,
            expires_at: self.expires_at,
            result_ttl_ms: self.result_ttl_ms,
            namespace: self.namespace,
            has_deps,
        }
    }
}

pub fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_millis()
        .min(i64::MAX as u128) as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Lock the Rust→JSON wire contract for `JobStatus`. The Redis backend's
    /// Lua scripts compare `job.status` against `JobStatus::wire_name()`; if
    /// `serde_derive` ever stops emitting the variant name verbatim (e.g.
    /// someone adds `#[serde(rename_all = "...")]`), this test fails before
    /// the divergence ships.
    #[test]
    fn wire_name_matches_serde_output() {
        for status in [
            JobStatus::Pending,
            JobStatus::Running,
            JobStatus::Complete,
            JobStatus::Failed,
            JobStatus::Dead,
            JobStatus::Cancelled,
        ] {
            let json = serde_json::to_string(&status).expect("serialize JobStatus");
            assert_eq!(
                json,
                format!("\"{}\"", status.wire_name()),
                "wire_name() drift for {status:?}",
            );
        }
    }
}
