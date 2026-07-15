import type {
  CircuitBreakerInput,
  MeshWorkerConfig,
  EnqueueOptions as NativeEnqueueOptions,
  PublishOptions as NativePublishOptions,
} from "./native";

export type {
  CircuitBreakerInput as CircuitBreakerOptions,
  JobFilter,
  JsCircuitBreaker as CircuitBreaker,
  JsDagEdge as DagEdge,
  JsDeadJob as DeadJob,
  JsJob as Job,
  JsJobDag as JobDag,
  JsJobError as JobError,
  JsMetric as Metric,
  JsReplayEntry as ReplayEntry,
  JsStats as Stats,
  JsSubscription as Subscription,
  JsTaskLog as TaskLog,
  JsWorkerRow as WorkerInfo,
  MeshWorkerConfig,
} from "./native";

/**
 * Per-job enqueue options. Mirrors the native options, but `notes` is a
 * structured object here (validated and JSON-encoded before it reaches the
 * core) rather than a pre-encoded string.
 */
export interface EnqueueOptions extends Omit<NativeEnqueueOptions, "notes"> {
  /** Structured annotations stored on the job — at most 15 fields, 4 KiB encoded. */
  notes?: Record<string, unknown>;
}

/**
 * Per-publish options. Mirrors the native options, but `notes` is a structured
 * object here (validated and JSON-encoded before it reaches the core) rather
 * than a pre-encoded string.
 */
export interface PublishOptions extends Omit<NativePublishOptions, "notes"> {
  /** Structured annotations stamped on every delivery (plus `topic`/`subscription`). */
  notes?: Record<string, unknown>;
}

/** Options for {@link Queue.subscriber}: task options plus subscription routing.
 *  `codecs` is not supported — published payloads use the queue-level serializer. */
export interface SubscriberOptions extends TaskOptions {
  /** Stable subscription identity — re-registering the same `(topic, name)`
   *  updates the routing target instead of duplicating. Defaults to the task name. */
  subscriptionName?: string;
  /** Queue the subscriber's delivery jobs go to (default `"default"`). */
  queue?: string;
  /** Persist across restarts (default true). `false` = ephemeral: registered
   *  only by a running worker and reaped once that worker stops heartbeating. */
  durable?: boolean;
}

/** Options for {@link Queue.result}. */
export interface ResultOptions {
  /** Max time to wait for a terminal state (ms). Default 30000. */
  timeoutMs?: number;
  /** Poll interval (ms). Default 50. */
  pollMs?: number;
}

/** Options for {@link Queue.stream}. */
export interface StreamOptions {
  /** Max time to wait for the job to terminate (ms). Default 60000. */
  timeoutMs?: number;
  /** Poll interval (ms). Default 200. */
  pollMs?: number;
}

/**
 * A registered task: receives the deserialized positional args and returns a
 * (possibly async) result.
 */
export type TaskHandler<Args extends unknown[] = unknown[], Result = unknown> = (
  ...args: Args
) => Result | Promise<Result>;

/** A heterogeneous task handler, as stored in the registry. */
// biome-ignore lint/suspicious/noExplicitAny: registry handlers have varied signatures
export type AnyHandler = (...args: any[]) => any;

/** Task name -> handler signature, accumulated by chaining {@link Queue.task}. */
export type TaskMap = Record<string, AnyHandler>;

/** A rate-limit spec: `<count>/<unit>` with unit `s | m | h` (e.g. `"100/m"`). */
export type RateLimit = `${number}/${"s" | "m" | "h"}`;

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
  /**
   * Cap on this task's share of one worker's in-flight slots, so a slow task
   * cannot occupy the pool and starve the others. Unlike {@link maxConcurrent}
   * (the cluster-wide cap, which costs a database read) this one is in-process.
   */
  maxInFlightPerTask?: number;
  /** Rate-limit spec like `"100/m"`, `"50/s"`, `"3600/h"`. */
  rateLimit?: RateLimit;
  /** Trip the task's circuit breaker after repeated failures. */
  circuitBreaker?: CircuitBreakerInput;
  /**
   * Resource names injected as a trailing `deps` object: the handler is called
   * `handler(...args, deps)`. Use the {@link Queue.task} `inject` overload so the
   * `deps` param is stripped from the typed `enqueue` args.
   */
  inject?: readonly string[];
  /**
   * Names of payload codecs (registered via `QueueOptions.codecs`) applied in
   * order to this task's serialized payload on enqueue and reversed on the
   * worker. Payload only — results stay on the queue serializer.
   */
  codecs?: readonly string[];
}

/** Options for {@link Queue.registerPeriodic}. */
export interface PeriodicOptions {
  /** Positional args passed to the task each time it fires. */
  args?: unknown[];
  /** Queue the periodic job runs on (default `"default"`). */
  queue?: string;
  /** IANA timezone for the cron schedule (default UTC). */
  timezone?: string;
  /** Register disabled (won't fire until re-registered enabled). Default true. */
  enabled?: boolean;
}

/** A registered periodic task, as returned by {@link Queue.listPeriodic}. Timestamps are Unix ms. */
export interface PeriodicTask {
  name: string;
  taskName: string;
  cronExpr: string;
  queue: string;
  enabled: boolean;
  /** Last fire time, or absent if it has not run yet. */
  lastRun?: number;
  nextRun: number;
  /** IANA timezone the cron is evaluated in, or absent for UTC. */
  timezone?: string;
}

/** Per-queue resilience config. */
export interface QueueLimits {
  maxConcurrent?: number;
  rateLimit?: RateLimit;
}

/** A task handler plus its registration options. */
export interface RegisteredTask {
  handler: AnyHandler;
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
  /**
   * Opt-in decentralized mesh overlay (peer gossip + work-stealing). Requires
   * the native addon to be built with the `mesh` cargo feature; ignored otherwise.
   */
  mesh?: MeshWorkerConfig;
  /**
   * Advance workflow runs as this worker's node-jobs settle (default true when
   * the addon supports workflows). Adds one job lookup per terminal job; set
   * false on workers that never process workflow steps.
   */
  advanceWorkflows?: boolean;
}
