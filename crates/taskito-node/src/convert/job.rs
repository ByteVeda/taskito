//! Marshalling between core job types and JS-facing shapes. Kept out of the
//! logic modules so `queue`/`worker` read as intent, not plumbing.

use napi::bindgen_prelude::Buffer;
use napi_derive::napi;
use taskito_core::job::now_millis;
use taskito_core::{Job, NewJob};

use crate::config::EnqueueOptions;

const DEFAULT_QUEUE: &str = "default";
const DEFAULT_MAX_RETRIES: i32 = 3;
const DEFAULT_TIMEOUT_MS: i64 = 300_000;

/// Build a [`NewJob`] from a task name, opaque payload bytes, and JS options.
/// The core never interprets `payload` — the shell owns (de)serialization.
pub fn build_new_job(task_name: String, payload: Vec<u8>, opts: EnqueueOptions) -> NewJob {
    NewJob {
        queue: opts.queue.unwrap_or_else(|| DEFAULT_QUEUE.to_string()),
        task_name,
        payload,
        priority: opts.priority.unwrap_or(0),
        scheduled_at: now_millis(),
        max_retries: opts.max_retries.unwrap_or(DEFAULT_MAX_RETRIES),
        timeout_ms: opts.timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS),
        unique_key: None,
        metadata: None,
        notes: None,
        depends_on: Vec::new(),
        expires_at: None,
        result_ttl_ms: None,
        namespace: None,
    }
}

/// Passed to the JS task callback for each dispatched job. `payload` is the
/// opaque arg blob the shell deserializes before running the task.
#[napi(object)]
pub struct JsTaskInvocation {
    pub id: String,
    pub task_name: String,
    pub payload: Buffer,
}

/// JS-facing view of a stored [`Job`]. `result` is the opaque result blob (or
/// `null`); the shell deserializes it.
#[napi(object)]
pub struct JsJob {
    pub id: String,
    pub queue: String,
    pub task_name: String,
    pub status: String,
    pub priority: i32,
    pub retry_count: i32,
    pub max_retries: i32,
    pub result: Option<Buffer>,
    pub error: Option<String>,
    pub created_at: i64,
    pub completed_at: Option<i64>,
}

/// Convert a core [`Job`] into its JS-facing shape.
pub fn job_to_js(job: Job) -> JsJob {
    JsJob {
        id: job.id,
        queue: job.queue,
        task_name: job.task_name,
        status: job.status.wire_name().to_string(),
        priority: job.priority,
        retry_count: job.retry_count,
        max_retries: job.max_retries,
        result: job.result.map(Buffer::from),
        error: job.error,
        created_at: job.created_at,
        completed_at: job.completed_at,
    }
}
