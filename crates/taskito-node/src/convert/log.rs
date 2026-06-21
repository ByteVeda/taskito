//! Marshalling for task logs / published partial results.

use napi_derive::napi;
use taskito_core::storage::models::TaskLogRow;

/// JS-facing view of a task log entry. A published partial result is a log with
/// `level === "result"` and the value in `extra`.
#[napi(object)]
pub struct JsTaskLog {
    pub id: String,
    pub job_id: String,
    pub task_name: String,
    pub level: String,
    pub message: String,
    pub extra: Option<String>,
    pub logged_at: i64,
}

pub fn log_to_js(row: TaskLogRow) -> JsTaskLog {
    JsTaskLog {
        id: row.id,
        job_id: row.job_id,
        task_name: row.task_name,
        level: row.level,
        message: row.message,
        extra: row.extra,
        logged_at: row.logged_at,
    }
}
