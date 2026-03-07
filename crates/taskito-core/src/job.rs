use serde::{Deserialize, Serialize};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use uuid::Uuid;

use crate::storage::models::JobRow;

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
    pub cancel_requested: bool,
    pub expires_at: Option<i64>,
    pub result_ttl_ms: Option<i64>,
    pub namespace: Option<String>,
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
            cancel_requested: row.cancel_requested != 0,
            expires_at: row.expires_at,
            result_ttl_ms: row.result_ttl_ms,
            namespace: row.namespace,
        }
    }
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
    pub depends_on: Vec<String>,
    pub expires_at: Option<i64>,
    pub result_ttl_ms: Option<i64>,
    pub namespace: Option<String>,
}

impl NewJob {
    pub fn into_job(self) -> Job {
        let now = now_millis();
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
            cancel_requested: false,
            expires_at: self.expires_at,
            result_ttl_ms: self.result_ttl_ms,
            namespace: self.namespace,
        }
    }
}

pub fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_millis() as i64
}
