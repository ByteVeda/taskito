//! JSON API handlers over a {@link Queue}. Pure data — no HTTP concerns here.

import type { Queue } from "../index";

function numParam(query: URLSearchParams, key: string): number | undefined {
  const value = query.get(key);
  if (value === null) {
    return undefined;
  }
  const num = Number(value);
  // Drop NaN/negative so they never reach the backend as bogus limit/offset.
  return Number.isFinite(num) && num >= 0 ? num : undefined;
}

export async function getStats(queue: Queue) {
  return { overall: await queue.stats(), queues: await queue.statsAllQueues() };
}

export async function getQueues(queue: Queue) {
  return { paused: queue.listPausedQueues(), stats: await queue.statsAllQueues() };
}

export function getJobs(queue: Queue, query: URLSearchParams) {
  return queue.listJobs({
    status: query.get("status") ?? undefined,
    queue: query.get("queue") ?? undefined,
    task: query.get("task") ?? undefined,
    limit: numParam(query, "limit"),
    offset: numParam(query, "offset"),
  });
}

export function getDeadLetters(queue: Queue, query: URLSearchParams) {
  return queue.deadLetters(numParam(query, "limit"), numParam(query, "offset"));
}

export function cancelJob(queue: Queue, id: string) {
  return { id, cancelled: queue.cancelJob(id) || queue.requestCancel(id) };
}

export function retryDead(queue: Queue, id: string) {
  return { id: queue.retryDead(id) };
}

export function pauseQueue(queue: Queue, name: string) {
  queue.pauseQueue(name);
  return { paused: name };
}

export function resumeQueue(queue: Queue, name: string) {
  queue.resumeQueue(name);
  return { resumed: name };
}
