// Task & queue override endpoints.

import type { Queue } from "../../index";
import { BadRequestError, NotFoundError } from "../errors";

/** Every registered task with registration defaults + active override. */
export function listTasks(queue: Queue) {
  return queue.registeredTasks();
}

export function listQueues(queue: Queue) {
  return queue.registeredQueues();
}

function requireObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new BadRequestError("body must be a JSON object");
  }
  return body as Record<string, unknown>;
}

// ── Task overrides ──────────────────────────────────────────────────────

export function getTaskOverride(queue: Queue, taskName: string) {
  const override = queue.getTaskOverride(taskName);
  if (!override) {
    throw new NotFoundError(`no override set for task '${taskName}'`);
  }
  return override;
}

// Store-level ValidationError propagates to the server, which maps it to 400.
export function putTaskOverride(queue: Queue, taskName: string, body: unknown) {
  return queue.setTaskOverride(taskName, requireObject(body));
}

export function deleteTaskOverride(queue: Queue, taskName: string) {
  return { cleared: queue.clearTaskOverride(taskName) };
}

// ── Queue overrides ─────────────────────────────────────────────────────

export function getQueueOverride(queue: Queue, queueName: string) {
  const override = queue.getQueueOverride(queueName);
  if (!override) {
    throw new NotFoundError(`no override set for queue '${queueName}'`);
  }
  return override;
}

export function putQueueOverride(queue: Queue, queueName: string, body: unknown) {
  const fields = requireObject(body);
  const override = queue.setQueueOverride(queueName, fields);
  // "paused" propagates to running workers immediately via the paused-queues
  // store, independent of the static override consumed at worker startup.
  if ("paused" in fields) {
    if (fields.paused) {
      queue.pauseQueue(queueName);
    } else {
      queue.resumeQueue(queueName);
    }
  }
  return override;
}

export function deleteQueueOverride(queue: Queue, queueName: string) {
  return { cleared: queue.clearQueueOverride(queueName) };
}
