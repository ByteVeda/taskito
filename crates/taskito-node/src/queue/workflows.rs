//! Workflow submission, advancement, and queries.
//!
//! v1 covers DAG / linear workflows: every step is pre-enqueued with a
//! `depends_on` chain so the core scheduler runs the steps in topological order.
//! Advancement (`mark_workflow_node_result`) keeps the workflow run/node status
//! in sync as each step's job settles. Fan-out, gates, sub-workflows, and saga
//! compensation are not yet bound.

use std::collections::HashMap;

use napi::bindgen_prelude::{Buffer, Error, Result};
use napi_derive::napi;
use taskito_core::job::{now_millis, NewJob};
use taskito_core::{Storage, StorageBackend};
use taskito_workflows::{
    topological_order, StepMetadata, WorkflowDefinition, WorkflowNode, WorkflowNodeStatus,
    WorkflowRun, WorkflowSqliteStorage, WorkflowState, WorkflowStorage, WorkflowStorageBackend,
};

use super::JsQueue;
use crate::convert::{node_to_js, run_to_js, JsWorkflowAdvance, JsWorkflowNode, JsWorkflowRun};
use crate::error::to_napi_err;

const DEFAULT_QUEUE: &str = "default";
const DEFAULT_MAX_RETRIES: i32 = 3;
const DEFAULT_TIMEOUT_MS: i64 = 300_000;
const DEFAULT_LIST_LIMIT: i64 = 50;

#[napi]
impl JsQueue {
    /// Submit a workflow run from a serialized DAG plus per-step metadata and
    /// payloads. Pre-enqueues a job per step with a `depends_on` chain and
    /// records a `WorkflowRun` + a `WorkflowNode` per step. Returns the run id.
    #[napi]
    #[allow(clippy::too_many_arguments)]
    pub fn submit_workflow(
        &self,
        name: String,
        version: i32,
        dag_bytes: Buffer,
        step_metadata_json: String,
        node_payloads: HashMap<String, Buffer>,
        queue_default: Option<String>,
        params_json: Option<String>,
    ) -> Result<String> {
        let wf = self.workflow_store()?;
        let dag = dag_bytes.to_vec();
        let step_meta: HashMap<String, StepMetadata> =
            serde_json::from_str(&step_metadata_json).map_err(|e| reason(e.to_string()))?;
        let ordered = topological_order(&dag).map_err(to_napi_err)?;
        let queue_default = queue_default.unwrap_or_else(|| DEFAULT_QUEUE.to_string());

        let definition_id = match wf
            .get_workflow_definition(&name, Some(version))
            .map_err(to_napi_err)?
        {
            Some(existing) => existing.id,
            None => {
                let def = WorkflowDefinition {
                    id: uuid::Uuid::now_v7().to_string(),
                    name: name.clone(),
                    version,
                    dag_data: dag.clone(),
                    step_metadata: step_meta.clone(),
                    created_at: now_millis(),
                };
                let id = def.id.clone();
                wf.create_workflow_definition(&def).map_err(to_napi_err)?;
                id
            }
        };

        let run_id = uuid::Uuid::now_v7().to_string();
        let now = now_millis();
        let run = WorkflowRun {
            id: run_id.clone(),
            definition_id,
            params: params_json,
            state: WorkflowState::Pending,
            started_at: Some(now),
            completed_at: None,
            error: None,
            parent_run_id: None,
            parent_node_name: None,
            created_at: now,
        };
        wf.create_workflow_run(&run).map_err(to_napi_err)?;

        let mut job_ids: HashMap<String, String> = HashMap::new();
        for topo in &ordered {
            let meta = step_meta.get(&topo.name).ok_or_else(|| {
                reason(format!("step '{}' missing from step_metadata", topo.name))
            })?;
            let payload = node_payloads
                .get(&topo.name)
                .map(|b| b.to_vec())
                .ok_or_else(|| {
                    reason(format!("step '{}' missing from node_payloads", topo.name))
                })?;
            let depends_on = topo
                .predecessors
                .iter()
                .map(|p| {
                    job_ids.get(p).cloned().ok_or_else(|| {
                        reason(format!(
                            "predecessor '{}' of step '{}' has no job id",
                            p, topo.name
                        ))
                    })
                })
                .collect::<Result<Vec<String>>>()?;

            let new_job = NewJob {
                queue: meta.queue.clone().unwrap_or_else(|| queue_default.clone()),
                task_name: meta.task_name.clone(),
                payload,
                priority: meta.priority.unwrap_or(0),
                scheduled_at: now,
                max_retries: meta.max_retries.unwrap_or(DEFAULT_MAX_RETRIES),
                timeout_ms: meta.timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS),
                unique_key: None,
                metadata: Some(workflow_metadata_json(&run_id, &topo.name)),
                notes: None,
                depends_on,
                expires_at: None,
                result_ttl_ms: None,
                namespace: self.namespace.clone(),
            };
            let job = self.storage.enqueue(new_job).map_err(to_napi_err)?;
            job_ids.insert(topo.name.clone(), job.id.clone());

            let node = WorkflowNode {
                id: uuid::Uuid::now_v7().to_string(),
                run_id: run_id.clone(),
                node_name: topo.name.clone(),
                job_id: Some(job.id),
                status: WorkflowNodeStatus::Pending,
                result_hash: None,
                fan_out_count: None,
                fan_in_data: None,
                started_at: None,
                completed_at: None,
                error: None,
                compensation_job_id: None,
                compensation_started_at: None,
                compensation_completed_at: None,
                compensation_error: None,
            };
            wf.create_workflow_node(&node).map_err(to_napi_err)?;
        }

        wf.update_workflow_run_state(&run_id, WorkflowState::Running, None)
            .map_err(to_napi_err)?;
        Ok(run_id)
    }

    /// Record the terminal outcome of a workflow node's job. A no-op (returns
    /// `null`) for non-workflow jobs. On failure, cascades a fail-fast skip to
    /// the run's remaining pending nodes. When the run reaches a terminal state,
    /// the returned advance carries `finalState`.
    #[napi]
    pub fn mark_workflow_node_result(
        &self,
        job_id: String,
        succeeded: bool,
        error: Option<String>,
    ) -> Result<Option<JsWorkflowAdvance>> {
        let wf = self.workflow_store()?;
        let job = match self.storage.get_job(&job_id).map_err(to_napi_err)? {
            Some(j) => j,
            None => return Ok(None),
        };
        let (run_id, node_name) = match parse_workflow_metadata(job.metadata.as_deref()) {
            Some(pair) => pair,
            None => return Ok(None),
        };

        let now = now_millis();
        if succeeded {
            wf.set_workflow_node_completed(&run_id, &node_name, now, None)
                .map_err(to_napi_err)?;
        } else {
            let msg = error.clone().unwrap_or_else(|| "failed".to_string());
            wf.set_workflow_node_error(&run_id, &node_name, &msg)
                .map_err(to_napi_err)?;
            let nodes = wf.get_workflow_nodes(&run_id).map_err(to_napi_err)?;
            cascade_skip_pending(&self.storage, &wf, &run_id, &nodes);
        }

        let nodes = wf.get_workflow_nodes(&run_id).map_err(to_napi_err)?;
        if !nodes.iter().all(|n| n.status.is_terminal()) {
            return Ok(Some(JsWorkflowAdvance {
                run_id,
                node_name,
                final_state: None,
            }));
        }

        let any_failed = nodes.iter().any(|n| n.status == WorkflowNodeStatus::Failed);
        let final_state = if any_failed || !succeeded {
            WorkflowState::Failed
        } else {
            WorkflowState::Completed
        };
        wf.update_workflow_run_state(
            &run_id,
            final_state,
            if final_state == WorkflowState::Failed {
                error.as_deref()
            } else {
                None
            },
        )
        .map_err(to_napi_err)?;
        wf.set_workflow_run_completed(&run_id, now)
            .map_err(to_napi_err)?;

        Ok(Some(JsWorkflowAdvance {
            run_id,
            node_name,
            final_state: Some(final_state.as_str().to_string()),
        }))
    }

    /// Fetch a workflow run by id, or `null` if no such run exists.
    #[napi]
    pub fn get_workflow_run(&self, run_id: String) -> Result<Option<JsWorkflowRun>> {
        let wf = self.workflow_store()?;
        Ok(wf
            .get_workflow_run(&run_id)
            .map_err(to_napi_err)?
            .map(run_to_js))
    }

    /// List the nodes (steps) of a workflow run.
    #[napi]
    pub fn get_workflow_nodes(&self, run_id: String) -> Result<Vec<JsWorkflowNode>> {
        let wf = self.workflow_store()?;
        Ok(wf
            .get_workflow_nodes(&run_id)
            .map_err(to_napi_err)?
            .into_iter()
            .map(node_to_js)
            .collect())
    }

    /// List workflow runs, optionally filtered by definition name and/or state.
    #[napi]
    pub fn list_workflow_runs(
        &self,
        definition_name: Option<String>,
        state: Option<String>,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> Result<Vec<JsWorkflowRun>> {
        let wf = self.workflow_store()?;
        let state = match state {
            Some(s) => Some(
                WorkflowState::from_str_val(&s)
                    .ok_or_else(|| reason(format!("unknown workflow state '{s}'")))?,
            ),
            None => None,
        };
        let runs = wf
            .list_workflow_runs(
                definition_name.as_deref(),
                state,
                limit.unwrap_or(DEFAULT_LIST_LIMIT),
                offset.unwrap_or(0),
            )
            .map_err(to_napi_err)?;
        Ok(runs.into_iter().map(run_to_js).collect())
    }

    /// Lazily build the workflow storage from this queue's backend (runs the
    /// workflow migrations on first use). Not exported to JS.
    fn workflow_store(&self) -> Result<WorkflowStorageBackend> {
        if let Some(wf) = self.workflow_storage.get() {
            return Ok(wf.clone());
        }
        let wf = build_workflow_storage(&self.storage)?;
        // If another thread raced us, either handle wraps the same pool.
        let _ = self.workflow_storage.set(wf.clone());
        Ok(wf)
    }
}

/// Construct the workflow storage matching the queue's core backend.
fn build_workflow_storage(storage: &StorageBackend) -> Result<WorkflowStorageBackend> {
    let wf = match storage {
        StorageBackend::Sqlite(s) => WorkflowSqliteStorage::new(s.clone())
            .map(WorkflowStorageBackend::Sqlite)
            .map_err(to_napi_err)?,
        #[cfg(feature = "postgres")]
        StorageBackend::Postgres(s) => taskito_workflows::WorkflowPostgresStorage::new(s.clone())
            .map(WorkflowStorageBackend::Postgres)
            .map_err(to_napi_err)?,
        #[cfg(feature = "redis")]
        StorageBackend::Redis(s) => taskito_workflows::WorkflowRedisStorage::new(s.clone())
            .map(WorkflowStorageBackend::Redis)
            .map_err(to_napi_err)?,
    };
    Ok(wf)
}

/// Job-metadata blob that links a job back to its workflow node.
fn workflow_metadata_json(run_id: &str, node_name: &str) -> String {
    serde_json::json!({
        "workflow_run_id": run_id,
        "workflow_node_name": node_name,
    })
    .to_string()
}

/// Parse `{workflow_run_id, workflow_node_name}` from a job's metadata blob.
fn parse_workflow_metadata(metadata: Option<&str>) -> Option<(String, String)> {
    let parsed: serde_json::Value = serde_json::from_str(metadata?).ok()?;
    let run_id = parsed.get("workflow_run_id")?.as_str()?.to_string();
    let node_name = parsed.get("workflow_node_name")?.as_str()?.to_string();
    Some((run_id, node_name))
}

/// Fail-fast: mark every still-pending node skipped and cancel its job.
/// Best-effort — per-node failures are logged, not propagated.
fn cascade_skip_pending(
    storage: &StorageBackend,
    wf: &WorkflowStorageBackend,
    run_id: &str,
    nodes: &[WorkflowNode],
) {
    for node in nodes {
        if !matches!(
            node.status,
            WorkflowNodeStatus::Pending | WorkflowNodeStatus::Ready
        ) {
            continue;
        }
        if let Some(job_id) = &node.job_id {
            if let Err(e) = storage.cancel_job(job_id) {
                log::warn!("[taskito-node] cancel_job({job_id}) during workflow cascade: {e}");
            }
        }
        if let Err(e) =
            wf.update_workflow_node_status(run_id, &node.node_name, WorkflowNodeStatus::Skipped)
        {
            log::warn!("[taskito-node] skip node '{}' failed: {e}", node.node_name);
        }
    }
}

/// A JS error carrying a plain message (for validation / serde failures).
fn reason(message: impl Into<String>) -> Error {
    Error::new(napi::Status::GenericFailure, message.into())
}
