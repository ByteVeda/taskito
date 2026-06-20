//! Plain option objects passed from JavaScript. napi maps snake_case Rust
//! fields to camelCase JS keys (`maxRetries`, `timeoutMs`).

use napi_derive::napi;

/// Per-enqueue overrides. All optional — omitted fields fall back to defaults
/// in [`crate::conversion::build_new_job`].
#[napi(object)]
#[derive(Default)]
pub struct EnqueueOptions {
    pub queue: Option<String>,
    pub priority: Option<i32>,
    pub max_retries: Option<i32>,
    pub timeout_ms: Option<i64>,
}
