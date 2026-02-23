use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(i32)]
pub enum JobStatus {
    Pending = 0,
    Running = 1,
    Complete = 2,
    Failed = 3,
    Dead = 4,
}

impl JobStatus {
    pub fn from_i32(v: i32) -> Option<Self> {
        match v {
            0 => Some(Self::Pending),
            1 => Some(Self::Running),
            2 => Some(Self::Complete),
            3 => Some(Self::Failed),
            4 => Some(Self::Dead),
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
        }
    }
}

pub fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("time went backwards")
        .as_millis() as i64
}
