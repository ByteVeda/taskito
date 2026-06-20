import { TaskitoError } from "./errors";
import { JsQueue, type NativeQueue, type OpenOptions } from "./native";
import { JsonSerializer, type Serializer } from "./serializers";
import type {
  EnqueueOptions,
  Job,
  QueueLimits,
  RegisteredTask,
  TaskHandler,
  TaskOptions,
  WorkerRunOptions,
} from "./types";
import { Worker } from "./worker";

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
export class Queue {
  private readonly native: NativeQueue;
  private readonly serializer: Serializer;
  private readonly tasks = new Map<string, RegisteredTask>();
  private readonly queueLimits = new Map<string, QueueLimits>();

  constructor(options: QueueOptions) {
    this.native = JsQueue.open(toOpenOptions(options));
    this.serializer = options.serializer ?? new JsonSerializer();
  }

  /** Register a task handler under `name`, with optional per-task config. */
  task(name: string, handler: TaskHandler, options?: TaskOptions): void {
    this.tasks.set(name, { handler, options });
  }

  /** Set per-queue concurrency / rate-limit applied when a worker runs. */
  configureQueue(name: string, limits: QueueLimits): void {
    this.queueLimits.set(name, limits);
  }

  /** Enqueue `name` with positional `args`. Returns the new job id. */
  enqueue(name: string, args: unknown[] = [], options?: EnqueueOptions): string {
    const defaults = this.tasks.get(name)?.options;
    const merged: EnqueueOptions = {
      ...options,
      maxRetries: options?.maxRetries ?? defaults?.maxRetries,
      timeoutMs: options?.timeoutMs ?? defaults?.timeoutMs,
    };
    const payload = Buffer.from(this.serializer.serialize(args));
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

  /** Start a worker that runs the registered tasks. Hold the returned {@link Worker}. */
  runWorker(options?: WorkerRunOptions): Worker {
    return Worker.start(this.native, {
      tasks: this.tasks,
      queueLimits: this.queueLimits,
      serializer: this.serializer,
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
