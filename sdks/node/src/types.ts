export type { EnqueueOptions, JsJob as Job } from "./native";

/**
 * A registered task: receives the deserialized positional args and returns a
 * (possibly async) result.
 */
export type TaskHandler<Args extends unknown[] = unknown[], Result = unknown> = (
  ...args: Args
) => Result | Promise<Result>;

/** Per-task defaults and resilience config, applied when registering a task. */
export interface TaskOptions {
  /** Retry budget (also the per-job default at enqueue). */
  maxRetries?: number;
  /** Exponential backoff bounds for retries. */
  retryBackoff?: { baseMs?: number; maxMs?: number };
  /** Per-job timeout default (ms); enforced by the worker. */
  timeoutMs?: number;
  /** Cap on concurrently-running jobs of this task. */
  maxConcurrent?: number;
  /** Rate-limit spec like `"100/m"`, `"50/s"`, `"3600/h"`. */
  rateLimit?: string;
}

/** Per-queue resilience config. */
export interface QueueLimits {
  maxConcurrent?: number;
  rateLimit?: string;
}

/** A task handler plus its registration options. */
export interface RegisteredTask {
  handler: TaskHandler;
  options?: TaskOptions;
}

/** Options for {@link Queue.runWorker}. */
export interface WorkerRunOptions {
  /** Queues to consume (default `["default"]`). */
  queues?: string[];
  /** In-flight channel capacity (default 128). */
  channelCapacity?: number;
  /** Jobs claimed per scheduler poll (default 1). */
  batchSize?: number;
}
