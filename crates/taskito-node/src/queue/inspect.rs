//! Read-only inspection methods on `JsQueue`. These scan/aggregate over
//! storage, so each is async and offloads the blocking I/O to the blocking
//! pool instead of stalling the JS event loop for the DB round-trip.

use std::collections::HashMap;

use napi::bindgen_prelude::{spawn_blocking, Result};
use napi_derive::napi;
use taskito_core::Storage;

use super::JsQueue;
use crate::config::JobFilter;
use crate::convert::{
    job_error_to_js, job_to_js, metric_to_js, stats_to_js, status_code, worker_to_js, JsJob,
    JsJobError, JsMetric, JsStats, JsWorkerRow,
};
use crate::error::{invalid_arg, join_to_napi_err, non_negative, to_napi_err};

const DEFAULT_LIMIT: i64 = 50;

#[napi]
impl JsQueue {
    /// Job counts by status across all queues.
    #[napi]
    pub async fn stats(&self) -> Result<JsStats> {
        let storage = self.storage.clone();
        spawn_blocking(move || storage.stats().map(stats_to_js).map_err(to_napi_err))
            .await
            .map_err(join_to_napi_err)?
    }

    /// Job counts by status for a single queue.
    #[napi]
    pub async fn stats_by_queue(&self, queue: String) -> Result<JsStats> {
        let storage = self.storage.clone();
        spawn_blocking(move || {
            storage
                .stats_by_queue(&queue)
                .map(stats_to_js)
                .map_err(to_napi_err)
        })
        .await
        .map_err(join_to_napi_err)?
    }

    /// Job counts by status, keyed by queue name.
    #[napi]
    pub async fn stats_all_queues(&self) -> Result<HashMap<String, JsStats>> {
        let storage = self.storage.clone();
        spawn_blocking(move || {
            let all = storage.stats_all_queues().map_err(to_napi_err)?;
            Ok(all.into_iter().map(|(k, v)| (k, stats_to_js(v))).collect())
        })
        .await
        .map_err(join_to_napi_err)?
    }

    /// List jobs, optionally filtered by status/queue/task and paginated.
    #[napi]
    pub async fn list_jobs(&self, filter: Option<JobFilter>) -> Result<Vec<JsJob>> {
        let filter = filter.unwrap_or_default();
        // An unrecognized status would otherwise silently widen the result set
        // to every job; reject it so a typo fails loudly.
        let status = match filter.status.as_deref() {
            Some(s) => Some(
                status_code(s)
                    .ok_or_else(|| invalid_arg(format!("unknown status filter '{s}'")))?,
            ),
            None => None,
        };
        let limit = non_negative(filter.limit.unwrap_or(DEFAULT_LIMIT), "limit")?;
        let offset = non_negative(filter.offset.unwrap_or(0), "offset")?;
        let storage = self.storage.clone();
        let namespace = self.namespace.clone();
        spawn_blocking(move || {
            let jobs = storage
                .list_jobs(
                    status,
                    filter.queue.as_deref(),
                    filter.task.as_deref(),
                    limit,
                    offset,
                    namespace.as_deref(),
                )
                .map_err(to_napi_err)?;
            Ok(jobs.into_iter().map(job_to_js).collect())
        })
        .await
        .map_err(join_to_napi_err)?
    }

    /// Error history for a job (one entry per failed attempt).
    #[napi]
    pub async fn get_job_errors(&self, job_id: String) -> Result<Vec<JsJobError>> {
        let storage = self.storage.clone();
        spawn_blocking(move || {
            let errors = storage.get_job_errors(&job_id).map_err(to_napi_err)?;
            Ok(errors.into_iter().map(job_error_to_js).collect())
        })
        .await
        .map_err(join_to_napi_err)?
    }

    /// Per-execution task metrics within the last `since_ms` milliseconds.
    #[napi]
    pub async fn get_metrics(&self, task: Option<String>, since_ms: i64) -> Result<Vec<JsMetric>> {
        let storage = self.storage.clone();
        spawn_blocking(move || {
            let metrics = storage
                .get_metrics(task.as_deref(), since_ms)
                .map_err(to_napi_err)?;
            Ok(metrics.into_iter().map(metric_to_js).collect())
        })
        .await
        .map_err(join_to_napi_err)?
    }

    /// List registered workers (heartbeat + identity).
    #[napi]
    pub async fn list_workers(&self) -> Result<Vec<JsWorkerRow>> {
        let storage = self.storage.clone();
        spawn_blocking(move || {
            let workers = storage.list_workers().map_err(to_napi_err)?;
            Ok(workers.into_iter().map(worker_to_js).collect())
        })
        .await
        .map_err(join_to_napi_err)?
    }

    /// Record a heartbeat for a running worker, carrying its current resource
    /// health as a JSON object (`null` clears it). Called from the JS shell
    /// every 5s. Returns the ids of dead workers reaped as a side effect.
    #[napi]
    pub async fn worker_heartbeat(
        &self,
        worker_id: String,
        resource_health: Option<String>,
    ) -> Result<Vec<String>> {
        let storage = self.storage.clone();
        spawn_blocking(move || {
            storage
                .heartbeat(&worker_id, resource_health.as_deref())
                .map_err(to_napi_err)?;
            // Reaping is opportunistic — a failure must not fail the heartbeat.
            Ok(storage.reap_dead_workers().unwrap_or_default())
        })
        .await
        .map_err(join_to_napi_err)?
    }
}
