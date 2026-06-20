//! Marshalling between core types and JS-facing shapes. One submodule per
//! concern; kept out of the logic modules so they read as intent, not plumbing.

mod job;

pub use job::{build_new_job, job_to_js, JsJob, JsTaskInvocation};
