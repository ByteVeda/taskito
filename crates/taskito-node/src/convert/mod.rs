//! Marshalling between core types and JS-facing shapes. One submodule per
//! concern; kept out of the logic modules so they read as intent, not plumbing.

mod job;
mod stats;
mod task_config;

pub use job::{build_new_job, job_to_js, JsJob, JsTaskInvocation};
pub use stats::{
    dead_job_to_js, job_error_to_js, metric_to_js, stats_to_js, status_code, worker_to_js,
    JsDeadJob, JsJobError, JsMetric, JsStats, JsWorkerRow,
};
pub use task_config::{queue_config, task_config};
