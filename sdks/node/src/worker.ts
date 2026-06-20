import { type JobContext, runInContext } from "./context";
import { TaskNotRegisteredError } from "./errors";
import type {
  JsTaskInvocation,
  NativeQueue,
  NativeWorker,
  WorkerOptions as NativeWorkerOptions,
  QueueConfigInput,
  TaskConfigInput,
} from "./native";
import type { Serializer } from "./serializers";
import type { QueueLimits, RegisteredTask, WorkerRunOptions } from "./types";

/** How often a running job polls the storage cancel flag. */
const CANCEL_POLL_INTERVAL_MS = 200;

/** Inputs assembled by {@link Queue.runWorker}. */
export interface WorkerStartParams {
  tasks: ReadonlyMap<string, RegisteredTask>;
  queueLimits: ReadonlyMap<string, QueueLimits>;
  serializer: Serializer;
  run?: WorkerRunOptions;
}

/** A running worker. Hold it for the worker's lifetime; call {@link Worker.stop}. */
export class Worker {
  private constructor(private readonly native: NativeWorker) {}

  /**
   * Start a worker from a queue's task registry. Use {@link Queue.runWorker}
   * rather than calling this directly.
   *
   * @internal
   */
  static start(queue: NativeQueue, params: WorkerStartParams): Worker {
    const { tasks, queueLimits, serializer, run } = params;
    const callback = async (invocation: JsTaskInvocation): Promise<Buffer> => {
      const task = tasks.get(invocation.taskName);
      if (!task) {
        throw new TaskNotRegisteredError(invocation.taskName);
      }
      const args = serializer.deserialize(invocation.payload) as unknown[];

      // Drive a cooperative cancel signal from the storage flag, and expose the
      // job context (id, signal, progress) to the handler.
      const controller = new AbortController();
      const context: JobContext = {
        jobId: invocation.id,
        signal: controller.signal,
        setProgress: (progress) => queue.updateProgress(invocation.id, progress),
      };
      const poller = setInterval(() => {
        try {
          if (queue.isCancelRequested(invocation.id)) {
            controller.abort();
          }
        } catch {
          // transient storage error — retry on the next tick
        }
      }, CANCEL_POLL_INTERVAL_MS);
      poller.unref();

      try {
        const result = await runInContext(context, () => task.handler(...args));
        return Buffer.from(serializer.serialize(result));
      } finally {
        clearInterval(poller);
      }
    };

    const nativeOptions: NativeWorkerOptions = {
      queues: run?.queues,
      channelCapacity: run?.channelCapacity,
      batchSize: run?.batchSize,
      taskConfigs: buildTaskConfigs(tasks),
      queueConfigs: buildQueueConfigs(queueLimits),
    };
    return new Worker(queue.runWorker(callback, nativeOptions));
  }

  /** Stop the worker; in-flight results drain before background tasks exit. */
  stop(): void {
    this.native.stop();
  }
}

/** Collect per-task configs that actually set something. */
function buildTaskConfigs(tasks: ReadonlyMap<string, RegisteredTask>): TaskConfigInput[] {
  const configs: TaskConfigInput[] = [];
  for (const [name, task] of tasks) {
    const options = task.options;
    if (
      !options ||
      (options.maxRetries === undefined &&
        options.retryBackoff === undefined &&
        options.maxConcurrent === undefined &&
        options.rateLimit === undefined)
    ) {
      continue;
    }
    configs.push({
      name,
      maxRetries: options.maxRetries,
      retryBaseDelayMs: options.retryBackoff?.baseMs,
      retryMaxDelayMs: options.retryBackoff?.maxMs,
      maxConcurrent: options.maxConcurrent,
      rateLimit: options.rateLimit,
    });
  }
  return configs;
}

function buildQueueConfigs(limits: ReadonlyMap<string, QueueLimits>): QueueConfigInput[] {
  return [...limits].map(([name, limit]) => ({
    name,
    maxConcurrent: limit.maxConcurrent,
    rateLimit: limit.rateLimit,
  }));
}
