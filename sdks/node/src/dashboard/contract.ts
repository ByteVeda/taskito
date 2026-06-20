// Map the SDK's camelCase shapes to the snake_case JSON contract the React SPA
// (`dashboard/`) expects. Timestamps are Unix milliseconds throughout.

import type { DeadJob, Job, WorkerInfo } from "../types";
import type { Webhook } from "../webhooks";
import type { WorkflowNode, WorkflowRun } from "../workflows";

/** Replace header values with a mask so outbound credentials aren't exposed. */
function maskHeaderValues(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.keys(headers).map((name) => [name, "***"]));
}

/** Map a webhook to the SPA contract — secret and header values are never exposed. */
export function webhookToContract(webhook: Webhook) {
  return {
    id: webhook.id,
    url: webhook.url,
    events: webhook.events,
    task_filter: webhook.taskFilter ?? null,
    // Mask header values — they may carry outbound credentials. Keep names so
    // the UI can show which headers are configured.
    headers: maskHeaderValues(webhook.headers),
    has_secret: Boolean(webhook.secret),
    max_retries: webhook.maxRetries,
    timeout_seconds: webhook.timeoutMs / 1000,
    retry_backoff: 2.0,
    enabled: webhook.enabled,
    description: webhook.description ?? null,
    created_at: webhook.createdAt,
    updated_at: webhook.updatedAt,
  };
}

export function jobToContract(job: Job) {
  return {
    id: job.id,
    task_name: job.taskName,
    queue: job.queue,
    status: job.status,
    priority: job.priority,
    progress: job.progress ?? null,
    retry_count: job.retryCount,
    max_retries: job.maxRetries,
    created_at: job.createdAt,
    scheduled_at: job.scheduledAt,
    started_at: job.startedAt ?? null,
    completed_at: job.completedAt ?? null,
    timeout_ms: job.timeoutMs,
    error: job.error ?? null,
    unique_key: job.uniqueKey ?? null,
    metadata: job.metadata ?? null,
    notes: job.notes ?? null,
    namespace: job.namespace ?? null,
  };
}

export function workerToContract(worker: WorkerInfo) {
  return {
    worker_id: worker.workerId,
    queues: worker.queues,
    status: worker.status,
    last_heartbeat: worker.lastHeartbeat,
    registered_at: worker.startedAt ?? worker.lastHeartbeat,
    hostname: worker.hostname ?? null,
    pid: worker.pid ?? null,
    pool_type: worker.poolType ?? null,
    tags: worker.tags ?? null,
  };
}

export function workflowRunToContract(run: WorkflowRun) {
  return {
    id: run.id,
    definition_id: run.definitionId,
    state: run.state,
    params: run.params ?? null,
    started_at: run.startedAt ?? null,
    completed_at: run.completedAt ?? null,
    error: run.error ?? null,
    parent_run_id: run.parentRunId ?? null,
    parent_node_name: run.parentNodeName ?? null,
    created_at: run.createdAt,
  };
}

export function workflowNodeToContract(node: WorkflowNode) {
  // fan-out / saga fields are always null in the Node SDK (v1 = plain DAGs).
  return {
    node_name: node.nodeName,
    status: node.status,
    job_id: node.jobId ?? null,
    result_hash: node.resultHash ?? null,
    fan_out_count: null,
    started_at: node.startedAt ?? null,
    completed_at: node.completedAt ?? null,
    error: node.error ?? null,
    compensation_job_id: null,
    compensation_started_at: null,
    compensation_completed_at: null,
    compensation_error: null,
  };
}

export function deadToContract(dead: DeadJob) {
  return {
    id: dead.id,
    original_job_id: dead.originalJobId,
    task_name: dead.taskName,
    queue: dead.queue,
    error: dead.error ?? null,
    retry_count: dead.retryCount,
    failed_at: dead.failedAt,
    metadata: dead.metadata ?? null,
    dlq_retry_count: dead.dlqRetryCount,
  };
}
