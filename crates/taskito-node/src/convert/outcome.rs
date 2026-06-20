//! Map the core's [`ResultOutcome`] to a JS-facing shape for the events layer.

use napi_derive::napi;
use taskito_core::scheduler::ResultOutcome;

/// The outcome of a finished job, delivered to the worker's outcome callback.
/// `kind` is `"success" | "retry" | "dead" | "cancelled"`.
#[napi(object)]
pub struct JsOutcome {
    pub kind: String,
    pub job_id: String,
    pub task_name: String,
    pub queue: Option<String>,
    pub error: Option<String>,
    pub retry_count: Option<i32>,
    pub timed_out: Option<bool>,
}

pub fn outcome_to_js(outcome: &ResultOutcome) -> JsOutcome {
    match outcome {
        ResultOutcome::Success { job_id, task_name } => JsOutcome {
            kind: "success".to_string(),
            job_id: job_id.clone(),
            task_name: task_name.clone(),
            queue: None,
            error: None,
            retry_count: None,
            timed_out: None,
        },
        ResultOutcome::Retry {
            job_id,
            task_name,
            queue,
            error,
            retry_count,
            timed_out,
        } => JsOutcome {
            kind: "retry".to_string(),
            job_id: job_id.clone(),
            task_name: task_name.clone(),
            queue: Some(queue.clone()),
            error: Some(error.clone()),
            retry_count: Some(*retry_count),
            timed_out: Some(*timed_out),
        },
        ResultOutcome::DeadLettered {
            job_id,
            task_name,
            queue,
            error,
            timed_out,
        } => JsOutcome {
            kind: "dead".to_string(),
            job_id: job_id.clone(),
            task_name: task_name.clone(),
            queue: Some(queue.clone()),
            error: Some(error.clone()),
            retry_count: None,
            timed_out: Some(*timed_out),
        },
        ResultOutcome::Cancelled {
            job_id,
            task_name,
            queue,
        } => JsOutcome {
            kind: "cancelled".to_string(),
            job_id: job_id.clone(),
            task_name: task_name.clone(),
            queue: Some(queue.clone()),
            error: None,
            retry_count: None,
            timed_out: None,
        },
    }
}
