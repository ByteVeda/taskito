import { JobCancelledError, JobFailedError, LockNotAcquiredError, TaskitoError } from "./errors";
import { Emitter, type EventHandler, type EventName } from "./events";
import { Lock, type LockOptions } from "./locks";
import type { Middleware } from "./middleware";
import { JsQueue, type NativeQueue, type OpenOptions } from "./native";
import { JsonSerializer, type Serializer } from "./serializers";
import type {
  AnyHandler,
  DeadJob,
  EnqueueOptions,
  Job,
  JobError,
  JobFilter,
  Metric,
  PeriodicOptions,
  QueueLimits,
  RegisteredTask,
  ResultOptions,
  Stats,
  TaskMap,
  TaskOptions,
  WorkerInfo,
  WorkerRunOptions,
} from "./types";
import { WebhookManager } from "./webhooks";
import { Worker } from "./worker";
import { WorkflowManager } from "./workflows";

/** Construction options for a {@link Queue}. */
export interface QueueOptions {
  /** SQLite file path — shorthand for `{ backend: "sqlite", dsn: path }`. */
  dbPath?: string;
  /** `"sqlite"` (default), `"postgres"`, or `"redis"`. */
  backend?: "sqlite" | "postgres" | "redis";
  /** Backend connection string (SQLite path, Postgres URL, Redis URL). */
  dsn?: string;
  /** Connection pool size (SQLite/Postgres). */
  poolSize?: number;
  /** Postgres schema (default `"taskito"`). */
  schema?: string;
  /** Redis key prefix. */
  prefix?: string;
  /** Namespace applied to enqueued jobs and the worker scheduler. */
  namespace?: string;
  /** Codec for task args/results. Defaults to {@link JsonSerializer}. */
  serializer?: Serializer;
}

/**
 * A Taskito queue: register tasks, enqueue work, read results, and run workers.
 * Backed by the Rust core over SQLite, Postgres, or Redis.
 */
export class Queue<TTasks extends TaskMap = TaskMap> {
  private readonly native: NativeQueue;
  private readonly serializer: Serializer;
  private readonly tasks = new Map<string, RegisteredTask>();
  private readonly queueLimits = new Map<string, QueueLimits>();
  private readonly middleware: Middleware[] = [];
  private readonly emitter = new Emitter();
  private readonly webhookManager: WebhookManager;
  /** Built lazily — its constructor throws on addons lacking the `workflows` feature. */
  private workflowManager?: WorkflowManager;

  constructor(options: QueueOptions) {
    this.native = JsQueue.open(toOpenOptions(options));
    this.serializer = options.serializer ?? new JsonSerializer();
    this.webhookManager = new WebhookManager(this.native, this.emitter);
  }

  /** Webhook subscriptions — create/list/delete and deliver job events to URLs. */
  get webhooks(): WebhookManager {
    return this.webhookManager;
  }

  /** Workflow definitions and runs — DAG/linear orchestration over the queue. */
  get workflows(): WorkflowManager {
    if (!this.workflowManager) {
      this.workflowManager = new WorkflowManager(this.native, this.serializer);
    }
    return this.workflowManager;
  }

  /** Create a distributed lock handle (not yet acquired). */
  lock(name: string, options?: LockOptions): Lock {
    return new Lock(this.native, name, options);
  }

  /**
   * Run `fn` while holding the named lock, releasing it afterwards. Rejects with
   * {@link LockNotAcquiredError} if another owner holds the lock.
   */
  async withLock<T>(name: string, fn: () => T | Promise<T>, options?: LockOptions): Promise<T> {
    const lock = this.lock(name, options);
    if (!lock.acquire()) {
      throw new LockNotAcquiredError(name);
    }
    try {
      return await fn();
    } finally {
      lock.release();
    }
  }

  /**
   * Register (or replace) a cron-scheduled task. A running worker enqueues
   * `taskName` with the serialized `args` each time the schedule fires. Returns
   * the next fire time (Unix ms); throws on an invalid cron expression.
   */
  registerPeriodic(
    name: string,
    taskName: string,
    cronExpr: string,
    options?: PeriodicOptions,
  ): number {
    const args = Buffer.from(this.serializer.serialize(options?.args ?? []));
    return this.native.registerPeriodic(
      name,
      taskName,
      cronExpr,
      args,
      options?.queue,
      options?.timezone,
      options?.enabled,
    );
  }

  /**
   * Register a task handler under `name`. Chain calls to build a typed registry —
   * {@link Queue.enqueue} then infers each task's argument types.
   */
  task<Name extends string, Handler extends AnyHandler>(
    name: Name,
    handler: Handler,
    options?: TaskOptions,
  ): Queue<TTasks & Record<Name, Handler>> {
    this.tasks.set(name, { handler, options });
    return this as unknown as Queue<TTasks & Record<Name, Handler>>;
  }

  /** Set per-queue concurrency / rate-limit applied when a worker runs. */
  configureQueue(name: string, limits: QueueLimits): void {
    this.queueLimits.set(name, limits);
  }

  /** Register middleware (execution + outcome hooks). Runs in registration order. */
  use(middleware: Middleware): void {
    this.middleware.push(middleware);
  }

  /** Subscribe to a job lifecycle event. */
  on(event: EventName, handler: EventHandler): void {
    this.emitter.on(event, handler);
  }

  /** Unsubscribe from a job lifecycle event. */
  off(event: EventName, handler: EventHandler): void {
    this.emitter.off(event, handler);
  }

  /** Enqueue `name` with positional `args` (typed per the registered task). Returns the job id.
   * `args` stays optional so the in-place `queue.task(...)` registration pattern (where the
   * variable's type isn't refined) keeps working for zero-arg tasks. */
  enqueue<Name extends keyof TTasks & string>(
    name: Name,
    args?: Parameters<TTasks[Name]>,
    options?: EnqueueOptions,
  ): string {
    const defaults = this.tasks.get(name)?.options;
    const merged: EnqueueOptions = {
      ...options,
      maxRetries: options?.maxRetries ?? defaults?.maxRetries,
      timeoutMs: options?.timeoutMs ?? defaults?.timeoutMs,
    };
    const payload = Buffer.from(this.serializer.serialize(args ?? []));
    return this.native.enqueue(name, payload, merged);
  }

  /** Fetch a job by id, or `null` if unknown. */
  getJob(id: string): Job | null {
    return this.native.getJob(id);
  }

  /** Deserialized result of a completed job, or `undefined` if not yet ready. */
  getResult(id: string): unknown {
    const job = this.native.getJob(id);
    if (!job?.result) {
      return undefined;
    }
    return this.serializer.deserialize(job.result);
  }

  /** Cancel a pending job. Returns false if it was not pending. */
  cancelJob(id: string): boolean {
    return this.native.cancelJob(id);
  }

  /** Request cooperative cancellation of a running job. Returns false if it is not running. */
  requestCancel(id: string): boolean {
    return this.native.requestCancel(id);
  }

  /** Whether cancellation has been requested for a job. */
  isCancelRequested(id: string): boolean {
    return this.native.isCancelRequested(id);
  }

  /**
   * Await a job's terminal state and return its deserialized result. Rejects
   * with {@link JobFailedError} / {@link JobCancelledError} on failure, and with
   * {@link TaskitoError} if the wait times out.
   */
  async result(id: string, options?: ResultOptions): Promise<unknown> {
    const timeoutMs = options?.timeoutMs ?? 30_000;
    const pollMs = options?.pollMs ?? 50;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const job = this.native.getJob(id);
      if (job) {
        switch (job.status) {
          case "complete":
            return job.result ? this.serializer.deserialize(job.result) : undefined;
          case "failed":
          case "dead":
            throw new JobFailedError(id, job.error ?? "job failed");
          case "cancelled":
            throw new JobCancelledError(id);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    throw new TaskitoError(`timed out waiting for job ${id}`);
  }

  /** Job counts by status across all queues. */
  stats(): Stats {
    return this.native.stats();
  }

  /** Job counts by status for a single queue. */
  statsByQueue(queue: string): Stats {
    return this.native.statsByQueue(queue);
  }

  /** Job counts by status, keyed by queue name. */
  statsAllQueues(): Record<string, Stats> {
    return this.native.statsAllQueues();
  }

  /** List jobs, optionally filtered and paginated. */
  listJobs(filter?: JobFilter): Job[] {
    return this.native.listJobs(filter);
  }

  /** Error history for a job (one entry per failed attempt). */
  getJobErrors(id: string): JobError[] {
    return this.native.getJobErrors(id);
  }

  /** Per-execution task metrics within the last `sinceMs` milliseconds. */
  getMetrics(sinceMs: number, task?: string): Metric[] {
    return this.native.getMetrics(task ?? null, sinceMs);
  }

  /** List dead-letter entries (paginated). */
  deadLetters(limit?: number, offset?: number): DeadJob[] {
    return this.native.deadLetters(limit, offset);
  }

  /** Re-enqueue a dead-letter entry. Returns the new job id. */
  retryDead(deadId: string): string {
    return this.native.retryDead(deadId);
  }

  /** Delete a dead-letter entry. Returns false if it didn't exist. */
  deleteDead(deadId: string): boolean {
    return this.native.deleteDead(deadId);
  }

  /** Purge dead-letter entries older than `olderThanMs`. Returns the count removed. */
  purgeDead(olderThanMs: number): number {
    return this.native.purgeDead(olderThanMs);
  }

  /** Purge completed jobs older than `olderThanMs`. Returns the count removed. */
  purgeCompleted(olderThanMs: number): number {
    return this.native.purgeCompleted(olderThanMs);
  }

  /** Pause a queue — workers stop dispatching its jobs until resumed. */
  pauseQueue(queue: string): void {
    this.native.pauseQueue(queue);
  }

  /** Resume a paused queue. */
  resumeQueue(queue: string): void {
    this.native.resumeQueue(queue);
  }

  /** Names of currently-paused queues. */
  listPausedQueues(): string[] {
    return this.native.listPausedQueues();
  }

  /** Registered workers (heartbeat + identity). */
  listWorkers(): WorkerInfo[] {
    return this.native.listWorkers();
  }

  /** Start a worker that runs the registered tasks. Hold the returned {@link Worker}. */
  runWorker(options?: WorkerRunOptions): Worker {
    return Worker.start(this.native, {
      tasks: this.tasks,
      queueLimits: this.queueLimits,
      serializer: this.serializer,
      middleware: this.middleware,
      emitter: this.emitter,
      run: options,
    });
  }
}

/** Resolve a {@link QueueOptions} into the native open options. */
function toOpenOptions(options: QueueOptions): OpenOptions {
  const dsn = options.dsn ?? options.dbPath;
  if (!dsn) {
    throw new TaskitoError("Queue requires `dbPath` (SQLite) or `dsn`");
  }
  return {
    backend: options.backend ?? (options.dbPath ? "sqlite" : undefined),
    dsn,
    poolSize: options.poolSize,
    schema: options.schema,
    prefix: options.prefix,
    namespace: options.namespace,
  };
}
