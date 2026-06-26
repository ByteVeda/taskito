//! JNI entry points backing `org.byteveda.taskito.internal.NativeWorkflows`.
//!
//! Compiled only with the `workflows` feature. Static DAG steps are pre-enqueued
//! with a `depends_on` chain so the core scheduler runs them in topological
//! order; the worker-side `WorkflowTracker` records each node's terminal outcome
//! (and cascades a fail-fast skip) via [`mark_node_result`]. Deferred steps
//! (fan-out, gates, sub-workflows) are not produced by the Java builder yet, but
//! the submit path tracks them so the surface stays forward-compatible.

use std::collections::{HashMap, HashSet};

use jni::objects::{JClass, JObjectArray, JString};
use jni::sys::{jboolean, jint, jlong, jstring, JNI_FALSE};
use jni::JNIEnv;
use serde::{Deserialize, Serialize};
use taskito_core::job::{now_millis, NewJob};
use taskito_core::Storage;
use taskito_workflows::dagron_core::DAG;
use taskito_workflows::{
    topological_order, StepMetadata, WorkflowDefinition, WorkflowNode, WorkflowNodeStatus,
    WorkflowRun, WorkflowState, WorkflowStorage, WorkflowStorageBackend,
};
use uuid::Uuid;

use crate::backend::QueueHandle;
use crate::convert::{parse_json, to_json};
use crate::error::BindingError;
use crate::ffi::{
    guard, new_string, read_bytes_array, read_optional_string, read_string, read_string_array,
};

const DEFAULT_QUEUE: &str = "default";
const DEFAULT_MAX_RETRIES: i32 = 3;
const DEFAULT_TIMEOUT_MS: i64 = 300_000;

/// One step as described by the Java builder. Edges come from `after`.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StepSpec {
    name: String,
    task_name: String,
    #[serde(default)]
    after: Vec<String>,
    queue: Option<String>,
    max_retries: Option<i32>,
    timeout_ms: Option<i64>,
    priority: Option<i32>,
}

/// Combined run + node snapshot returned by `getWorkflowStatus`. Timestamps are
/// Unix milliseconds; `state`/`status` are the lowercase wire strings.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkflowStatusView<'a> {
    run_id: &'a str,
    state: &'static str,
    started_at: Option<i64>,
    completed_at: Option<i64>,
    error: Option<&'a str>,
    nodes: Vec<NodeView<'a>>,
}

/// One node within a run.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NodeView<'a> {
    node_name: &'a str,
    status: &'static str,
    job_id: Option<&'a str>,
    result_hash: Option<&'a str>,
    fan_out_count: Option<i32>,
    started_at: Option<i64>,
    completed_at: Option<i64>,
    error: Option<&'a str>,
}

impl<'a> From<&'a WorkflowNode> for NodeView<'a> {
    fn from(n: &'a WorkflowNode) -> Self {
        Self {
            node_name: &n.node_name,
            status: n.status.as_str(),
            job_id: n.job_id.as_deref(),
            result_hash: n.result_hash.as_deref(),
            fan_out_count: n.fan_out_count,
            started_at: n.started_at,
            completed_at: n.completed_at,
            error: n.error.as_deref(),
        }
    }
}

/// Borrow the queue behind a handle.
///
/// # Safety
/// `handle` must be a live `QueueHandle` pointer (see [`crate::handle`]).
unsafe fn borrow_queue<'a>(handle: jlong) -> &'a QueueHandle {
    crate::handle::borrow::<QueueHandle>(handle)
}

/// `String submitWorkflow(long, String name, int version, String stepsJson,
/// String[] payloadNames, byte[][] payloads, String queueDefault,
/// String paramsJson, String[] deferredNames)` — record a run and pre-enqueue a
/// job per static step. Returns the run id.
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub extern "system" fn Java_org_byteveda_taskito_internal_NativeWorkflows_submitWorkflow<'local>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jlong,
    name: JString<'local>,
    version: jint,
    steps_json: JString<'local>,
    payload_names: JObjectArray<'local>,
    payloads: JObjectArray<'local>,
    queue_default: JString<'local>,
    params_json: JString<'local>,
    deferred_names: JObjectArray<'local>,
) -> jstring {
    guard(&mut env, std::ptr::null_mut(), |env| {
        let queue = unsafe { borrow_queue(handle) };
        let name = read_string(env, &name)?;
        let steps_raw = read_string(env, &steps_json)?;
        let names = read_string_array(env, &payload_names)?;
        let payload_bytes = read_bytes_array(env, &payloads)?;
        let queue_default = read_optional_string(env, &queue_default)?;
        let params = read_optional_string(env, &params_json)?;
        let deferred = read_string_array(env, &deferred_names)?;
        let run_id = submit(
            queue,
            name,
            version,
            &steps_raw,
            names,
            payload_bytes,
            queue_default,
            params,
            deferred,
        )?;
        new_string(env, run_id)
    })
}

#[allow(clippy::too_many_arguments)]
fn submit(
    queue: &QueueHandle,
    name: String,
    version: i32,
    steps_json: &str,
    payload_names: Vec<String>,
    payloads: Vec<Vec<u8>>,
    queue_default: Option<String>,
    params_json: Option<String>,
    deferred_names: Vec<String>,
) -> Result<String, BindingError> {
    if payload_names.len() != payloads.len() {
        return Err(BindingError::new(
            "payloadNames and payloads must have equal length",
        ));
    }
    let wf = queue.workflow_store()?;
    let specs: Vec<StepSpec> = parse_json(steps_json, "workflow steps")?;

    // Add every node first, then the edges, so steps may be declared in any
    // order (a step's `after` need not have been declared before it).
    let mut dag: DAG<()> = DAG::new();
    for spec in &specs {
        dag.add_node(spec.name.clone(), ()).map_err(|e| {
            BindingError::new(format!("workflow add_node('{}') failed: {e}", spec.name))
        })?;
    }
    for spec in &specs {
        for pred in &spec.after {
            dag.add_edge(pred, &spec.name, None, None).map_err(|e| {
                BindingError::new(format!(
                    "workflow add_edge('{pred}' -> '{}') failed: {e}",
                    spec.name
                ))
            })?;
        }
    }
    let dag_bytes = dag
        .to_json(|_| None)
        .map_err(|e| BindingError::new(format!("workflow DAG serialize failed: {e}")))?
        .into_bytes();

    let step_meta: HashMap<String, StepMetadata> = specs
        .iter()
        .map(|s| {
            (
                s.name.clone(),
                StepMetadata {
                    task_name: s.task_name.clone(),
                    queue: s.queue.clone(),
                    max_retries: s.max_retries,
                    timeout_ms: s.timeout_ms,
                    priority: s.priority,
                    ..Default::default()
                },
            )
        })
        .collect();

    let node_payloads: HashMap<String, Vec<u8>> = payload_names.into_iter().zip(payloads).collect();
    let deferred: HashSet<String> = deferred_names.into_iter().collect();
    let queue_default = queue_default.unwrap_or_else(|| DEFAULT_QUEUE.to_string());
    let ordered = topological_order(&dag_bytes)?;

    // Reuse a stored definition only when its DAG matches; otherwise the run
    // would execute one topology while `definition_id` points at another.
    let definition_id = match wf.get_workflow_definition(&name, Some(version))? {
        Some(existing) => {
            if existing.dag_data != dag_bytes {
                return Err(BindingError::new(format!(
                    "workflow '{name}' v{version} already exists with a different DAG; bump the version"
                )));
            }
            existing.id
        }
        None => {
            let def = WorkflowDefinition {
                id: Uuid::now_v7().to_string(),
                name: name.clone(),
                version,
                dag_data: dag_bytes.clone(),
                step_metadata: step_meta.clone(),
                created_at: now_millis(),
            };
            let id = def.id.clone();
            wf.create_workflow_definition(&def)?;
            id
        }
    };

    let run_id = Uuid::now_v7().to_string();
    let now = now_millis();
    wf.create_workflow_run(&WorkflowRun {
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
    })?;

    let mut job_ids: HashMap<String, String> = HashMap::new();
    for topo in &ordered {
        let meta = step_meta
            .get(&topo.name)
            .ok_or_else(|| BindingError::new(format!("step '{}' missing metadata", topo.name)))?;

        // Deferred node: tracked but not enqueued; the tracker creates its job
        // once predecessors settle. (Not produced by the Java builder yet.)
        if deferred.contains(&topo.name) {
            wf.create_workflow_node(&new_node(&run_id, &topo.name, None))?;
            continue;
        }

        let payload = node_payloads
            .get(&topo.name)
            .cloned()
            .ok_or_else(|| BindingError::new(format!("step '{}' missing payload", topo.name)))?;
        // Only static predecessors gate this job; a deferred one has no job to
        // wait on, so the tracker enqueues nodes downstream of it.
        let depends_on = topo
            .predecessors
            .iter()
            .filter(|p| !deferred.contains(*p))
            .map(|p| {
                job_ids.get(p).cloned().ok_or_else(|| {
                    BindingError::new(format!("predecessor '{p}' of '{}' has no job", topo.name))
                })
            })
            .collect::<Result<Vec<String>, BindingError>>()?;

        let job = queue.storage.enqueue(NewJob {
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
            namespace: queue.namespace.clone(),
        })?;
        job_ids.insert(topo.name.clone(), job.id.clone());
        wf.create_workflow_node(&new_node(&run_id, &topo.name, Some(job.id)))?;
    }

    wf.update_workflow_run_state(&run_id, WorkflowState::Running, None)?;
    Ok(run_id)
}

/// `String markWorkflowNodeResult(long, String jobId, boolean succeeded,
/// String error, boolean skipCascade)` — record a node's terminal outcome.
/// Returns the run's final state when it reached terminal, else `null` (also for
/// non-workflow jobs).
#[no_mangle]
pub extern "system" fn Java_org_byteveda_taskito_internal_NativeWorkflows_markWorkflowNodeResult<
    'local,
>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jlong,
    job_id: JString<'local>,
    succeeded: jboolean,
    error: JString<'local>,
    skip_cascade: jboolean,
) -> jstring {
    guard(&mut env, std::ptr::null_mut(), |env| {
        let queue = unsafe { borrow_queue(handle) };
        let job_id = read_string(env, &job_id)?;
        let error = read_optional_string(env, &error)?;
        match mark_node_result(
            queue,
            &job_id,
            succeeded != JNI_FALSE,
            error,
            skip_cascade != JNI_FALSE,
        )? {
            Some(state) => new_string(env, state),
            None => Ok(std::ptr::null_mut()),
        }
    })
}

fn mark_node_result(
    queue: &QueueHandle,
    job_id: &str,
    succeeded: bool,
    error: Option<String>,
    skip_cascade: bool,
) -> Result<Option<String>, BindingError> {
    let wf = queue.workflow_store()?;
    let job = match queue.storage.get_job(job_id)? {
        Some(j) => j,
        None => return Ok(None),
    };
    let (run_id, node_name) = match parse_workflow_metadata(job.metadata.as_deref()) {
        Some(pair) => pair,
        None => return Ok(None),
    };

    let now = now_millis();
    if succeeded {
        wf.set_workflow_node_completed(&run_id, &node_name, now, None)?;
    } else {
        let msg = error.clone().unwrap_or_else(|| "failed".to_string());
        wf.set_workflow_node_error(&run_id, &node_name, &msg)?;
        if !skip_cascade {
            let nodes = wf.get_workflow_nodes(&run_id)?;
            cascade_skip_pending(queue, &wf, &run_id, &nodes);
        }
    }

    // Tracker-managed run: it owns cascade + finalization. Not used by the
    // current Java tracker (static DAGs), kept for forward compatibility.
    if skip_cascade {
        return Ok(None);
    }

    let nodes = wf.get_workflow_nodes(&run_id)?;
    if !nodes.iter().all(|n| n.status.is_terminal()) {
        return Ok(None);
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
    )?;
    wf.set_workflow_run_completed(&run_id, now)?;
    Ok(Some(final_state.as_str().to_string()))
}

/// `String getWorkflowStatus(long, String runId)` — a JSON run + node snapshot,
/// or `null` if no such run exists.
#[no_mangle]
pub extern "system" fn Java_org_byteveda_taskito_internal_NativeWorkflows_getWorkflowStatus<
    'local,
>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jlong,
    run_id: JString<'local>,
) -> jstring {
    guard(&mut env, std::ptr::null_mut(), |env| {
        let queue = unsafe { borrow_queue(handle) };
        let run_id = read_string(env, &run_id)?;
        let wf = queue.workflow_store()?;
        let run = match wf.get_workflow_run(&run_id)? {
            Some(r) => r,
            None => return Ok(std::ptr::null_mut()),
        };
        let nodes = wf.get_workflow_nodes(&run_id)?;
        let view = WorkflowStatusView {
            run_id: &run.id,
            state: run.state.as_str(),
            started_at: run.started_at,
            completed_at: run.completed_at,
            error: run.error.as_deref(),
            nodes: nodes.iter().map(NodeView::from).collect(),
        };
        new_string(env, to_json(&view)?)
    })
}

/// `void cancelWorkflowRun(long, String runId)` — skip every pending node
/// (cancelling its job), request cancel on running nodes, and mark the run
/// `cancelled`.
#[no_mangle]
pub extern "system" fn Java_org_byteveda_taskito_internal_NativeWorkflows_cancelWorkflowRun<
    'local,
>(
    mut env: JNIEnv<'local>,
    _class: JClass<'local>,
    handle: jlong,
    run_id: JString<'local>,
) {
    guard(&mut env, (), |env| {
        let queue = unsafe { borrow_queue(handle) };
        let run_id = read_string(env, &run_id)?;
        let wf = queue.workflow_store()?;
        for node in &wf.get_workflow_nodes(&run_id)? {
            match node.status {
                WorkflowNodeStatus::Pending | WorkflowNodeStatus::Ready => {
                    if let Some(job_id) = &node.job_id {
                        let _ = queue.storage.cancel_job(job_id);
                    }
                    wf.update_workflow_node_status(
                        &run_id,
                        &node.node_name,
                        WorkflowNodeStatus::Skipped,
                    )?;
                }
                WorkflowNodeStatus::Running => {
                    if let Some(job_id) = &node.job_id {
                        let _ = queue.storage.request_cancel(job_id);
                    }
                }
                _ => {}
            }
        }
        wf.update_workflow_run_state(&run_id, WorkflowState::Cancelled, None)?;
        wf.set_workflow_run_completed(&run_id, now_millis())?;
        Ok(())
    })
}

/// A fresh `Pending` node. `job_id` is `None` for deferred nodes.
fn new_node(run_id: &str, node_name: &str, job_id: Option<String>) -> WorkflowNode {
    WorkflowNode {
        id: Uuid::now_v7().to_string(),
        run_id: run_id.to_string(),
        node_name: node_name.to_string(),
        job_id,
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
    }
}

/// Job-metadata blob linking a job back to its workflow node.
fn workflow_metadata_json(run_id: &str, node_name: &str) -> String {
    serde_json::json!({
        "workflow_run_id": run_id,
        "workflow_node_name": node_name,
    })
    .to_string()
}

/// Parse `{workflow_run_id, workflow_node_name}` from a job's metadata. Returns
/// `None` for compensation jobs so they never advance the forward run.
fn parse_workflow_metadata(metadata: Option<&str>) -> Option<(String, String)> {
    let parsed: serde_json::Value = serde_json::from_str(metadata?).ok()?;
    if parsed
        .get("compensation")
        .and_then(serde_json::Value::as_bool)
        == Some(true)
    {
        return None;
    }
    let run_id = parsed.get("workflow_run_id")?.as_str()?.to_string();
    let node_name = parsed.get("workflow_node_name")?.as_str()?.to_string();
    Some((run_id, node_name))
}

/// Fail-fast: mark every still-pending node skipped and cancel its job.
/// Best-effort — per-node failures are logged, not propagated.
fn cascade_skip_pending(
    queue: &QueueHandle,
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
            if let Err(e) = queue.storage.cancel_job(job_id) {
                log::warn!("[taskito-java] cancel_job({job_id}) during workflow cascade: {e}");
            }
        }
        if let Err(e) =
            wf.update_workflow_node_status(run_id, &node.node_name, WorkflowNodeStatus::Skipped)
        {
            log::warn!("[taskito-java] skip node '{}' failed: {e}", node.node_name);
        }
    }
}
