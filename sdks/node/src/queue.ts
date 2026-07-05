import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  JobCancelledError,
  JobFailedError,
  LockLostError,
  LockNotAcquiredError,
  PredicateRejectedError,
  QueueError,
  ResultTimeoutError,
  TaskitoError,
} from "./errors";
import { Emitter, type EventHandler, type EventName } from "./events";
import { Lock, type LockOptions } from "./locks";
import type { EnqueueContext, Middleware } from "./middleware";
import {
  JsQueue,
  type EnqueueOptions as NativeEnqueueOptions,
  type NativeQueue,
  type OpenOptions,
} from "./native";
import { encodeNotes } from "./notes";
import type { Predicate } from "./predicates";
import {
  type ResourceContext,
  type ResourceMetrics,
  ResourceRuntime,
  type ResourceScope,
} from "./resources";
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
  PeriodicTask,
  QueueLimits,
  RegisteredTask,
  ResultOptions,
  Stats,
  StreamOptions,
  TaskLog,
  TaskMap,
  TaskOptions,
  WorkerInfo,
  WorkerRunOptions,
} from "./types";
import { WebhookManager } from "./webhooks";
import { Worker } from "./worker";
import { WorkflowManager } from "./workflows";
import { WorkflowTracker } from "./workflows/tracker";

/** Construction options for a {@link Queue}. */
export interface QueueOptions {
  /** SQLite file path — shorthand for `{ backend: "sqlite", dsn: path }`.
   *  Defaults to `.taskito/taskito.db`; missing parent directories are created. */
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
  private readonly gates = new Map<string, Predicate[]>();
  private readonly emitter = new Emitter();
  private readonly resources = new ResourceRuntime();
  private readonly webhookManager: WebhookManager;
  /** Built lazily — its constructor throws on addons lacking the `workflows` feature. */
  private workflowManager?: WorkflowManager;
  /** Shared by workers and `workflows.resolveGate()` so gate timers clear. */
  private workflowTracker?: WorkflowTracker;

  constructor(options: QueueOptions = {}) {
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
      this.workflowManager = new WorkflowManager(
        this.native,
        this.serializer,
        this.trackerIfSupported(),
      );
    }
    return this.workflowManager;
  }

  /** The shared workflow tracker, or `undefined` on addons without workflows. */
  private trackerIfSupported(): WorkflowTracker | undefined {
    if (typeof this.native.markWorkflowNodeResult !== "function") {
      return undefined;
    }
    this.workflowTracker ??= new WorkflowTracker(this.native, this.serializer);
    return this.workflowTracker;
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
    let result: T;
    try {
      result = await fn();
    } catch (error) {
      lock.release();
      throw error;
    }
    // `release()` returns false when the lease was lost mid-run — surface that
    // rather than pretending the critical section ran under a held lock.
    if (!lock.release()) {
      throw new LockLostError(name);
    }
    return result;
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

  /** Every registered periodic task, enabled or paused. */
  listPeriodic(): PeriodicTask[] {
    return this.native.listPeriodic();
  }

  /** Unschedule a periodic task. Returns false if none had that name. */
  deletePeriodic(name: string): boolean {
    return this.native.deletePeriodic(name);
  }

  /** Stop a periodic task from firing without removing it; false if none had that name. */
  pausePeriodic(name: string): boolean {
    return this.native.setPeriodicEnabled(name, false);
  }

  /** Resume a paused periodic task; false if none had that name. */
  resumePeriodic(name: string): boolean {
    return this.native.setPeriodicEnabled(name, true);
  }

  /**
   * Register a task that receives injected resources as a trailing `deps` object
   * (`handler(...args, deps)`). The `deps` param is stripped from the typed
   * {@link Queue.enqueue} args. Annotate `deps` to type the injected resources.
   */
  task<Name extends string, A extends unknown[], D, R>(
    name: Name,
    handler: (...args: [...A, deps: D]) => R | Promise<R>,
    options: TaskOptions & { inject: readonly string[] },
  ): Queue<TTasks & Record<Name, (...args: A) => R>>;
  /**
   * Register a task handler under `name`. Chain calls to build a typed registry —
   * {@link Queue.enqueue} then infers each task's argument types.
   */
  task<Name extends string, Handler extends AnyHandler>(
    name: Name,
    handler: Handler,
    options?: TaskOptions,
  ): Queue<TTasks & Record<Name, Handler>>;
  task(name: string, handler: AnyHandler, options?: TaskOptions): Queue<TaskMap> {
    this.tasks.set(name, { handler, options });
    return this as unknown as Queue<TaskMap>;
  }

  /**
   * Register an injectable resource. Worker-scoped (default) values are built
   * once and shared across the worker's lifetime; task-scoped values are built
   * per job invocation. Reach them from a handler via `useResource(name)` or the
   * declarative `inject` option on {@link Queue.task}.
   */
  resource<T>(
    name: string,
    factory: (ctx: ResourceContext) => T | Promise<T>,
    options?: { scope?: ResourceScope; dispose?: (value: T) => void | Promise<void> },
  ): this {
    this.resources.register<T>(name, {
      factory,
      scope: options?.scope ?? "worker",
      dispose: options?.dispose,
    });
    return this;
  }

  /** Per-resource lifecycle metrics (created / disposed / active), keyed by name. */
  resourceMetrics(): ResourceMetrics {
    return this.resources.metrics();
  }

  /** Set per-queue concurrency / rate-limit applied when a worker runs. */
  configureQueue(name: string, limits: QueueLimits): void {
    this.queueLimits.set(name, limits);
  }

  /** Register middleware (execution + outcome hooks). Runs in registration order. */
  use(middleware: Middleware): void {
    this.middleware.push(middleware);
  }

  /**
   * Gate enqueues of `name` with a predicate evaluated at enqueue time (after
   * `onEnqueue`). If it returns `false`, the enqueue throws
   * {@link PredicateRejectedError}. Multiple gates on a task all must pass.
   */
  gate<Name extends keyof TTasks & string>(
    name: Name,
    predicate: (ctx: { taskName: Name; args: Parameters<TTasks[Name]> }) => boolean,
  ): this {
    const list = this.gates.get(name) ?? [];
    list.push(predicate as Predicate);
    this.gates.set(name, list);
    return this;
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
    const { payload, options: nativeOpts } = this.prepareEnqueue(name, args, options);
    return this.native.enqueue(name, payload, nativeOpts);
  }

  /**
   * Enqueue many jobs of `name` in one storage round-trip. Each entry is its own
   * typed `args` + `options`. Returns the new job ids in input order. Unlike
   * {@link Queue.enqueue}, the batch path does not apply `uniqueKey` dedup.
   */
  enqueueMany<Name extends keyof TTasks & string>(
    name: Name,
    jobs: ReadonlyArray<{ args?: Parameters<TTasks[Name]>; options?: EnqueueOptions }>,
  ): string[] {
    const prepared = jobs.map((job) => this.prepareEnqueue(name, job.args, job.options));
    return this.native.enqueueMany(name, prepared);
  }

  /**
   * Merge per-task defaults, run the `onEnqueue` interception hooks, then
   * serialize the args and encode the options — the shared path for
   * {@link Queue.enqueue} and {@link Queue.enqueueMany}.
   */
  private prepareEnqueue<Name extends keyof TTasks & string>(
    name: Name,
    args: Parameters<TTasks[Name]> | undefined,
    options: EnqueueOptions | undefined,
  ): { payload: Buffer; options: NativeEnqueueOptions } {
    const defaults = this.tasks.get(name)?.options;
    const merged: EnqueueOptions = {
      ...options,
      maxRetries: options?.maxRetries ?? defaults?.maxRetries,
      timeoutMs: options?.timeoutMs ?? defaults?.timeoutMs,
    };
    // Interception seam: let middleware validate/redact/rewrite before serializing.
    const ctx: EnqueueContext = { taskName: name, args: [...(args ?? [])], options: merged };
    for (const mw of this.middleware) {
      mw.onEnqueue?.(ctx);
    }
    // Gate: predicates see the (possibly rewritten) args and may reject the enqueue.
    for (const gate of this.gates.get(name) ?? []) {
      if (!gate({ taskName: name, args: ctx.args })) {
        throw new PredicateRejectedError(name);
      }
    }
    return {
      payload: Buffer.from(this.serializer.serialize(ctx.args)),
      options: toNativeEnqueueOptions(ctx.options),
    };
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
    throw new ResultTimeoutError(id, timeoutMs);
  }

  /**
   * Async-iterate the partial results a job publishes via `currentJob().publish()`,
   * in order, until the job terminates (or the timeout elapses). Each value is the
   * JSON-deserialized argument passed to `publish`.
   */
  async *stream(id: string, options?: StreamOptions): AsyncIterableIterator<unknown> {
    const timeoutMs = options?.timeoutMs ?? 60_000;
    const pollMs = options?.pollMs ?? 200;
    const deadline = Date.now() + timeoutMs;
    // Cursor-based: each poll fetches only rows after the last seen log id
    // (UUIDv7 → time-ordered), instead of rescanning the full history.
    let cursor: string | undefined;
    for (;;) {
      const batch = this.newPartials(id, cursor);
      cursor = batch.cursor;
      yield* batch.values;
      const job = this.native.getJob(id);
      if (job && TERMINAL_STATUSES.has(job.status)) {
        yield* this.newPartials(id, cursor).values; // drain values committed at completion
        return;
      }
      if (Date.now() >= deadline) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }

  /** Raw task-log entries for a job (oldest first), including published partials. */
  taskLogs(id: string): TaskLog[] {
    return this.native.getTaskLogs(id);
  }

  /** Partial-result values logged after `cursor`, plus the advanced cursor. */
  private newPartials(id: string, cursor?: string): { values: unknown[]; cursor?: string } {
    const logs = this.native.getTaskLogsAfter(id, cursor);
    return {
      values: logs
        .filter((log) => log.level === STREAM_LEVEL)
        .map((log) => decodePartial(log.extra)),
      cursor: logs[logs.length - 1]?.id ?? cursor,
    };
  }

  /** Job counts by status across all queues. */
  stats(): Promise<Stats> {
    return this.native.stats();
  }

  /** Job counts by status for a single queue. */
  statsByQueue(queue: string): Promise<Stats> {
    return this.native.statsByQueue(queue);
  }

  /** Job counts by status, keyed by queue name. */
  statsAllQueues(): Promise<Record<string, Stats>> {
    return this.native.statsAllQueues();
  }

  /** List jobs, optionally filtered and paginated. */
  listJobs(filter?: JobFilter): Promise<Job[]> {
    return this.native.listJobs(filter);
  }

  /** Error history for a job (one entry per failed attempt). */
  getJobErrors(id: string): Promise<JobError[]> {
    return this.native.getJobErrors(id);
  }

  /** Per-execution task metrics recorded at or after `sinceMs` (Unix epoch ms). */
  getMetrics(sinceMs: number, task?: string): Promise<Metric[]> {
    return this.native.getMetrics(task ?? null, sinceMs);
  }

  /** List dead-letter entries (paginated). */
  deadLetters(limit?: number, offset?: number): Promise<DeadJob[]> {
    return this.native.deadLetters(limit, offset);
  }

  /** List dead-letter entries for a single task (paginated, newest first). */
  deadLettersByTask(taskName: string, limit?: number, offset?: number): Promise<DeadJob[]> {
    return this.native.deadLettersByTask(taskName, limit, offset);
  }

  /** Delete every dead-letter entry for a task. Returns the count removed. */
  purgeDeadByTask(taskName: string): Promise<number> {
    return this.native.purgeDeadByTask(taskName);
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
  purgeDead(olderThanMs: number): Promise<number> {
    return this.native.purgeDead(olderThanMs);
  }

  /** Purge completed jobs older than `olderThanMs`. Returns the count removed. */
  purgeCompleted(olderThanMs: number): Promise<number> {
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
  listWorkers(): Promise<WorkerInfo[]> {
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
      resources: this.resources,
      workflowTracker: this.trackerIfSupported(),
      run: options,
    });
  }
}

/** Log level used for published partial results (matches the cross-SDK contract). */
const STREAM_LEVEL = "result";
/** Job statuses at which a stream stops. */
const TERMINAL_STATUSES = new Set(["complete", "failed", "dead", "cancelled"]);

/** Decode a partial-result log's `extra` (JSON, falling back to the raw string). */
function decodePartial(extra: string | null | undefined): unknown {
  if (!extra) {
    return undefined;
  }
  try {
    return JSON.parse(extra);
  } catch {
    return extra;
  }
}

/**
 * Convert public enqueue options to the native shape: structured `notes` is
 * validated and encoded to canonical JSON; all other fields pass through.
 */
function toNativeEnqueueOptions(options: EnqueueOptions): NativeEnqueueOptions {
  const { notes, ...rest } = options;
  return notes === undefined ? rest : { ...rest, notes: encodeNotes(notes) };
}

/** Default on-disk SQLite location — mirrors the Python SDK's `.taskito/taskito.db`. */
const DEFAULT_SQLITE_DB = ".taskito/taskito.db";

/** Resolve a {@link QueueOptions} into the native open options. */
function toOpenOptions(options: QueueOptions): OpenOptions {
  const backend = options.backend ?? "sqlite";
  if (backend === "sqlite") {
    // Zero-config default, like Python: an on-disk DB under `.taskito/`.
    const dsn = options.dsn ?? options.dbPath ?? DEFAULT_SQLITE_DB;
    ensureSqliteParentDir(dsn);
    return { backend, dsn, poolSize: options.poolSize, namespace: options.namespace };
  }
  // Postgres/Redis have no sensible default endpoint — require an explicit dsn.
  // The Postgres `schema` (default `"taskito"`, resolved in the addon) and the
  // Redis `prefix` give each backend its own isolated namespace.
  const dsn = options.dsn;
  if (!dsn) {
    throw new QueueError(`Queue backend "${backend}" requires a \`dsn\` connection string`);
  }
  return {
    backend,
    dsn,
    poolSize: options.poolSize,
    schema: options.schema,
    prefix: options.prefix,
    namespace: options.namespace,
  };
}

/**
 * Create the parent directory of a SQLite file path, as the Python SDK does —
 * SQLite won't create missing directories itself. In-memory databases have no
 * parent and are skipped.
 */
function ensureSqliteParentDir(dsn: string): void {
  if (dsn === ":memory:" || dsn.startsWith("file::memory:")) {
    return;
  }
  const dir = dirname(dsn);
  if (dir && dir !== ".") {
    mkdirSync(dir, { recursive: true });
  }
}
