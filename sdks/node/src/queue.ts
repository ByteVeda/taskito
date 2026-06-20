import { JsQueue, type NativeQueue } from "./native";
import { JsonSerializer, type Serializer } from "./serializers";
import type { EnqueueOptions, Job, TaskHandler, WorkerOptions } from "./types";
import { Worker } from "./worker";

/** Construction options for a {@link Queue}. */
export interface QueueOptions {
  /** Path to the SQLite database file (created if missing). */
  dbPath: string;
  /** Codec for task args/results. Defaults to {@link JsonSerializer}. */
  serializer?: Serializer;
}

/**
 * A Taskito queue: register tasks, enqueue work, read results, and run workers.
 * Backed by the Rust core over SQLite.
 */
export class Queue {
  private readonly native: NativeQueue;
  private readonly serializer: Serializer;
  private readonly tasks = new Map<string, TaskHandler>();

  constructor(options: QueueOptions) {
    this.native = new JsQueue(options.dbPath);
    this.serializer = options.serializer ?? new JsonSerializer();
  }

  /** Register a task handler under `name`. */
  task(name: string, handler: TaskHandler): void {
    this.tasks.set(name, handler);
  }

  /** Enqueue `name` with positional `args`. Returns the new job id. */
  enqueue(name: string, args: unknown[] = [], options?: EnqueueOptions): string {
    const payload = Buffer.from(this.serializer.serialize(args));
    return this.native.enqueue(name, payload, options);
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

  /** Start a worker that runs the registered tasks. Hold the returned {@link Worker}. */
  runWorker(options?: WorkerOptions): Worker {
    return Worker.start(this.native, this.tasks, this.serializer, options);
  }
}
