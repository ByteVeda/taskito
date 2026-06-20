// Map the SDK's camelCase shapes to the snake_case JSON contract the React SPA
// (`dashboard/`) expects. Timestamps are Unix milliseconds throughout.

import type { DeadJob, Job } from "../types";

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
