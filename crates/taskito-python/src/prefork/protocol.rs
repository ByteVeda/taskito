//! IPC message types for parent↔child communication.
//!
//! Uses JSON Lines (one JSON object per line) over stdio pipes.
//! The `payload` field is base64-encoded since it contains opaque bytes.

use base64::Engine;
use serde::{Deserialize, Serialize};

use taskito_core::job::Job;
use taskito_core::scheduler::JobResult;

/// Message sent from parent to child.
#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ParentMessage {
    Job {
        id: String,
        task_name: String,
        payload: String, // base64-encoded
        retry_count: i32,
        max_retries: i32,
        queue: String,
        timeout_ms: i64,
        namespace: Option<String>,
    },
    Shutdown,
}

impl From<&Job> for ParentMessage {
    fn from(job: &Job) -> Self {
        Self::Job {
            id: job.id.clone(),
            task_name: job.task_name.clone(),
            payload: base64::engine::general_purpose::STANDARD.encode(&job.payload),
            retry_count: job.retry_count,
            max_retries: job.max_retries,
            queue: job.queue.clone(),
            timeout_ms: job.timeout_ms,
            namespace: job.namespace.clone(),
        }
    }
}

/// Message sent from child to parent.
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ChildMessage {
    Ready,
    Success {
        job_id: String,
        result: Option<String>, // base64-encoded
        task_name: String,
        wall_time_ns: i64,
    },
    Failure {
        job_id: String,
        error: String,
        retry_count: i32,
        max_retries: i32,
        task_name: String,
        wall_time_ns: i64,
        should_retry: bool,
        timed_out: bool,
    },
    Cancelled {
        job_id: String,
        task_name: String,
        wall_time_ns: i64,
    },
}

impl ChildMessage {
    /// Convert a child message into a `JobResult` for the scheduler.
    /// Returns `None` for non-result messages (e.g. `Ready`).
    pub fn into_job_result(self) -> Option<JobResult> {
        match self {
            Self::Ready => None,
            Self::Success {
                job_id,
                result,
                task_name,
                wall_time_ns,
            } => {
                let result_bytes = result
                    .and_then(|b64| base64::engine::general_purpose::STANDARD.decode(b64).ok());
                Some(JobResult::Success {
                    job_id,
                    result: result_bytes,
                    task_name,
                    wall_time_ns,
                })
            }
            Self::Failure {
                job_id,
                error,
                retry_count,
                max_retries,
                task_name,
                wall_time_ns,
                should_retry,
                timed_out,
            } => Some(JobResult::Failure {
                job_id,
                error,
                retry_count,
                max_retries,
                task_name,
                wall_time_ns,
                should_retry,
                timed_out,
            }),
            Self::Cancelled {
                job_id,
                task_name,
                wall_time_ns,
            } => Some(JobResult::Cancelled {
                job_id,
                task_name,
                wall_time_ns,
            }),
        }
    }
}
