// JSON API handlers over a Queue, returning the SPA's snake_case contract.
// `undefined` from a handler means 404.

import type { Queue } from "../index";
import { deadToContract, jobToContract, workerToContract } from "./contract";
import { aggregateByTask, bucketTimeseries } from "./metrics";

function num(url: URL, key: string): number | undefined {
  const value = url.searchParams.get(key);
  return value === null ? undefined : Number(value);
}

export function stats(queue: Queue) {
  return queue.stats();
}

export function statsQueues(queue: Queue, url: URL) {
  const name = url.searchParams.get("queue");
  return name ? { [name]: queue.statsByQueue(name) } : queue.statsAllQueues();
}

export function queuesPaused(queue: Queue) {
  return queue.listPausedQueues();
}

export function jobs(queue: Queue, url: URL) {
  const sp = url.searchParams;
  const page = sp.get("page");
  const pageSize = sp.get("pageSize");
  const limit = sp.get("limit") ?? pageSize ?? undefined;
  const offset =
    sp.get("offset") ??
    (page !== null && pageSize !== null ? String(Number(page) * Number(pageSize)) : undefined);
  return queue
    .listJobs({
      status: sp.get("status") ?? undefined,
      queue: sp.get("queue") ?? undefined,
      task: sp.get("task") ?? undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
      offset: offset !== undefined ? Number(offset) : undefined,
    })
    .map(jobToContract);
}

export function job(queue: Queue, id: string) {
  const found = queue.getJob(id);
  return found ? jobToContract(found) : undefined;
}

export function deadLetters(queue: Queue, url: URL) {
  return queue.deadLetters(num(url, "limit"), num(url, "offset")).map(deadToContract);
}

export function metrics(queue: Queue, url: URL) {
  const since = Number(url.searchParams.get("since") ?? 3600);
  const task = url.searchParams.get("task") ?? undefined;
  return aggregateByTask(queue.getMetrics(Date.now() - since * 1000, task));
}

export function timeseries(queue: Queue, url: URL) {
  const since = Number(url.searchParams.get("since") ?? 3600);
  const bucket = Number(url.searchParams.get("bucket") ?? 60);
  return bucketTimeseries(queue.getMetrics(Date.now() - since * 1000, undefined), bucket * 1000);
}

export function workers(queue: Queue) {
  return queue.listWorkers().map(workerToContract);
}

// Open-mode auth (no login): the minimal boot responses the SPA needs.
export function authStatus() {
  return { setup_required: false };
}
export function whoami() {
  return {
    user: { username: "viewer", role: "admin", created_at: 0, last_login_at: 0 },
    csrf_token: "open",
    expires_at: 9_999_999_999_999,
  };
}

export function cancel(queue: Queue, id: string) {
  return { cancelled: queue.cancelJob(id) || queue.requestCancel(id) };
}
export function retryDead(queue: Queue, id: string) {
  return { new_job_id: queue.retryDead(id) };
}
export function pause(queue: Queue, name: string) {
  queue.pauseQueue(name);
  return { paused: name };
}
export function resume(queue: Queue, name: string) {
  queue.resumeQueue(name);
  return { resumed: name };
}
