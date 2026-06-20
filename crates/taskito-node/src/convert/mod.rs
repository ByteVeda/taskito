//! Marshalling between core types and JS-facing shapes. One submodule per
//! concern; kept out of the logic modules so they read as intent, not plumbing.

mod job;
mod task_config;

pub use job::{build_new_job, job_to_js, JsJob, JsTaskInvocation};
pub use task_config::{queue_config, task_config};
