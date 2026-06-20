import { type JobContext, runInContext } from "./context";
import { TaskNotRegisteredError } from "./errors";
import type { Emitter, EventName, OutcomeEvent } from "./events";
import type { Middleware, TaskContext } from "./middleware";
import type {
  JsOutcome,
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

/** Outcome kind -> event name + the middleware hook it triggers. */
const OUTCOMES: Record<string, { event: EventName; hook: keyof Middleware }> = {
  success: { event: "job.completed", hook: "onCompleted" },
  retry: { event: "job.retrying", hook: "onRetry" },
  dead: { event: "job.dead", hook: "onDeadLetter" },
  cancelled: { event: "job.cancelled", hook: "onCancel" },
};

/** Inputs assembled by {@link Queue.runWorker}. */
export interface WorkerStartParams {
  tasks: ReadonlyMap<string, RegisteredTask>;
  queueLimits: ReadonlyMap<string, QueueLimits>;
  serializer: Serializer;
  middleware: readonly Middleware[];
  emitter: Emitter;
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
    const { tasks, queueLimits, serializer, middleware, emitter, run } = params;

    const taskCallback = async (invocation: JsTaskInvocation): Promise<Buffer> => {
      const task = tasks.get(invocation.taskName);
      if (!task) {
        throw new TaskNotRegisteredError(invocation.taskName);
      }
      const args = serializer.deserialize(invocation.payload) as unknown[];
      const ctx: TaskContext = { jobId: invocation.id, taskName: invocation.taskName, args };

      // Cooperative cancel signal + job context exposed to the handler.
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
        for (const mw of middleware) {
          await mw.before?.(ctx);
        }
        const result = await runInContext(context, () => task.handler(...args));
        for (const mw of middleware) {
          await mw.after?.(ctx, result);
        }
        return Buffer.from(serializer.serialize(result));
      } catch (error) {
        for (const mw of middleware) {
          await mw.onError?.(ctx, error);
        }
        throw error;
      } finally {
        clearInterval(poller);
      }
    };

    const outcomeCallback = (outcome: JsOutcome): void => {
      const mapping = OUTCOMES[outcome.kind];
      if (!mapping) {
        return;
      }
      const event: OutcomeEvent = {
        jobId: outcome.jobId,
        taskName: outcome.taskName,
        queue: outcome.queue ?? undefined,
        error: outcome.error ?? undefined,
        retryCount: outcome.retryCount ?? undefined,
        timedOut: outcome.timedOut ?? undefined,
      };
      emitter.emit(mapping.event, event);
      for (const mw of middleware) {
        const hook = mw[mapping.hook] as ((e: OutcomeEvent) => void) | undefined;
        try {
          hook?.(event);
        } catch {
          // outcome hook errors must not break the worker
        }
      }
    };

    const nativeOptions: NativeWorkerOptions = {
      queues: run?.queues,
      channelCapacity: run?.channelCapacity,
      batchSize: run?.batchSize,
      taskConfigs: buildTaskConfigs(tasks),
      queueConfigs: buildQueueConfigs(queueLimits),
    };
    return new Worker(queue.runWorker(taskCallback, outcomeCallback, nativeOptions));
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
