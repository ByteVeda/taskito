//! Read-only inspection methods on `JsQueue`.

use std::collections::HashMap;

use napi::bindgen_prelude::Result;
use napi_derive::napi;
use taskito_core::Storage;

use super::JsQueue;
use crate::config::JobFilter;
use crate::convert::{
    job_error_to_js, job_to_js, metric_to_js, stats_to_js, status_code, JsJob, JsJobError,
    JsMetric, JsStats,
};
use crate::error::to_napi_err;

const DEFAULT_LIMIT: i64 = 50;

#[napi]
impl JsQueue {
    /// Job counts by status across all queues.
    #[napi]
    pub fn stats(&self) -> Result<JsStats> {
        self.storage.stats().map(stats_to_js).map_err(to_napi_err)
    }

    /// Job counts by status for a single queue.
    #[napi]
    pub fn stats_by_queue(&self, queue: String) -> Result<JsStats> {
        self.storage
            .stats_by_queue(&queue)
            .map(stats_to_js)
            .map_err(to_napi_err)
    }

    /// Job counts by status, keyed by queue name.
    #[napi]
    pub fn stats_all_queues(&self) -> Result<HashMap<String, JsStats>> {
        let all = self.storage.stats_all_queues().map_err(to_napi_err)?;
        Ok(all.into_iter().map(|(k, v)| (k, stats_to_js(v))).collect())
    }

    /// List jobs, optionally filtered by status/queue/task and paginated.
    #[napi]
    pub fn list_jobs(&self, filter: Option<JobFilter>) -> Result<Vec<JsJob>> {
        let filter = filter.unwrap_or_default();
        let jobs = self
            .storage
            .list_jobs(
                filter.status.as_deref().and_then(status_code),
                filter.queue.as_deref(),
                filter.task.as_deref(),
                filter.limit.unwrap_or(DEFAULT_LIMIT),
                filter.offset.unwrap_or(0),
                self.namespace.as_deref(),
            )
            .map_err(to_napi_err)?;
        Ok(jobs.into_iter().map(job_to_js).collect())
    }

    /// Error history for a job (one entry per failed attempt).
    #[napi]
    pub fn get_job_errors(&self, job_id: String) -> Result<Vec<JsJobError>> {
        let errors = self.storage.get_job_errors(&job_id).map_err(to_napi_err)?;
        Ok(errors.into_iter().map(job_error_to_js).collect())
    }

    /// Per-execution task metrics within the last `since_ms` milliseconds.
    #[napi]
    pub fn get_metrics(&self, task: Option<String>, since_ms: i64) -> Result<Vec<JsMetric>> {
        let metrics = self
            .storage
            .get_metrics(task.as_deref(), since_ms)
            .map_err(to_napi_err)?;
        Ok(metrics.into_iter().map(metric_to_js).collect())
    }
}
