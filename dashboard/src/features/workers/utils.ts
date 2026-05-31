import type { Worker } from "@/lib/api-types";

/** A worker is "stale" once its last heartbeat is older than this. */
export const WORKER_STALE_AFTER_MS = 30_000;

/**
 * Whether a worker has missed its heartbeat window. Computed against a
 * caller-supplied `now` so callers that re-render on a clock tick keep the
 * status fresh (the heartbeat ages relative to wall-clock, not a frozen ref).
 */
export function isWorkerStale(worker: Worker, now: number = Date.now()): boolean {
  return now - worker.last_heartbeat > WORKER_STALE_AFTER_MS;
}
