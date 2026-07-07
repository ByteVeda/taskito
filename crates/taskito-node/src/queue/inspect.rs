//! Read-only inspection methods on `JsQueue`. These scan/aggregate over
//! storage, so each is async and offloads the blocking I/O to the blocking
//! pool instead of stalling the JS event loop for the DB round-trip.

use std::collections::{HashMap, HashSet};

use napi::bindgen_prelude::{spawn_blocking, Result};
use napi_derive::napi;
use taskito_core::Storage;

use super::JsQueue;
use crate::config::JobFilter;
use crate::convert::{
    circuit_breaker_to_js, job_error_to_js, job_to_js, log_to_js, metric_to_js, replay_to_js,
    stats_to_js, status_code, worker_to_js, JsCircuitBreaker, JsDagEdge, JsJob, JsJobDag,
    JsJobError, JsMetric, JsReplayEntry, JsStats, JsTaskLog, JsWorkerRow,
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

    /// Task logs across jobs, filtered by task/level, newest first.
    /// `since_ms` is a Unix-ms lower bound on `logged_at`.
    #[napi]
    pub async fn query_task_logs(
        &self,
        task_name: Option<String>,
        level: Option<String>,
        since_ms: i64,
        limit: i64,
    ) -> Result<Vec<JsTaskLog>> {
        non_negative(limit, "limit")?;
        let storage = self.storage.clone();
        spawn_blocking(move || {
            let rows = storage
                .query_task_logs(task_name.as_deref(), level.as_deref(), since_ms, limit)
                .map_err(to_napi_err)?;
            Ok(rows.into_iter().map(log_to_js).collect())
        })
        .await
        .map_err(join_to_napi_err)?
    }

    /// Circuit-breaker state for every task that has one.
    #[napi]
    pub async fn list_circuit_breakers(&self) -> Result<Vec<JsCircuitBreaker>> {
        let storage = self.storage.clone();
        spawn_blocking(move || {
            let rows = storage.list_circuit_breakers().map_err(to_napi_err)?;
            Ok(rows.into_iter().map(circuit_breaker_to_js).collect())
        })
        .await
        .map_err(join_to_napi_err)?
    }

    /// Replays recorded for a job, newest first.
    #[napi]
    pub async fn get_replay_history(&self, job_id: String) -> Result<Vec<JsReplayEntry>> {
        let storage = self.storage.clone();
        spawn_blocking(move || {
            let rows = storage.get_replay_history(&job_id).map_err(to_napi_err)?;
            Ok(rows.into_iter().map(replay_to_js).collect())
        })
        .await
        .map_err(join_to_napi_err)?
    }

    /// The dependency DAG reachable from `job_id`: full job rows as nodes
    /// plus `dependency -> dependent` edges, walked in both directions.
    #[napi]
    pub async fn job_dag(&self, job_id: String) -> Result<JsJobDag> {
        let storage = self.storage.clone();
        spawn_blocking(move || {
            let mut visited: HashSet<String> = HashSet::new();
            // Both endpoints of an edge report it (dependencies from one
            // side, dependents from the other) — dedupe by (from, to).
            let mut seen_edges: HashSet<(String, String)> = HashSet::new();
            let mut nodes = Vec::new();
            let mut edges = Vec::new();
            let mut pending = vec![job_id];
            while let Some(current) = pending.pop() {
                if !visited.insert(current.clone()) {
                    continue;
                }
                let Some(job) = storage.get_job(&current).map_err(to_napi_err)? else {
                    continue;
                };
                nodes.push(job_to_js(job));
                for dep_id in storage.get_dependencies(&current).map_err(to_napi_err)? {
                    if seen_edges.insert((dep_id.clone(), current.clone())) {
                        edges.push(JsDagEdge {
                            from: dep_id.clone(),
                            to: current.clone(),
                        });
                    }
                    pending.push(dep_id);
                }
                for dep_id in storage.get_dependents(&current).map_err(to_napi_err)? {
                    if seen_edges.insert((current.clone(), dep_id.clone())) {
                        edges.push(JsDagEdge {
                            from: current.clone(),
                            to: dep_id.clone(),
                        });
                    }
                    pending.push(dep_id);
                }
            }
            Ok(JsJobDag { nodes, edges })
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
