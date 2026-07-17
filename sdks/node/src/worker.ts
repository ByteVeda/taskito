import { type JobContext, runInContext } from "./context";
import {
  applyQueueOverrides,
  applyTaskOverrides,
  MiddlewareDisableStore,
  middlewareKey,
  OverridesStore,
} from "./dashboard/stores";
import { SerializationError, TaskNotRegisteredError } from "./errors";
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
import { type ResourceRuntime, runWithResolver } from "./resources";
import { deserializeCall, type PayloadCodec, type Serializer } from "./serializers";
import { encodeTaskError } from "./task-error";
import type { QueueLimits, RegisteredTask, TaskOptions, WorkerRunOptions } from "./types";
import { createLogger } from "./utils";
import type { WorkflowTracker } from "./workflows";
import { CACHE_TASK } from "./workflows/cache";

const log = createLogger("worker");

/** How often a running job polls the storage cancel flag. */
const CANCEL_POLL_INTERVAL_MS = 200;

/** How often the worker heartbeats (with resource health) to storage. */
const HEARTBEAT_INTERVAL_MS = 5000;

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
  /** Named codec registry for per-task payload decode (see `TaskOptions.codecs`). */
  codecs?: ReadonlyMap<string, PayloadCodec>;
  middleware: readonly Middleware[];
  emitter: Emitter;
  resources: ResourceRuntime;
  /** The queue's shared tracker (undefined on addons without workflows). */
  workflowTracker?: WorkflowTracker;
  /** Flushes the queue's pending topic subscriptions under this worker's id. */
  declareSubscriptions?: (workerId: string) => Promise<void>;
  run?: WorkerRunOptions;
}

/** A running worker. Hold it for the worker's lifetime; call {@link Worker.stop}. */
export class Worker {
  private constructor(
    private readonly native: NativeWorker,
    private readonly queue: NativeQueue,
    private readonly resources: ResourceRuntime,
    private readonly heartbeat: ReturnType<typeof setInterval>,
  ) {}

  /**
   * Start a worker from a queue's task registry. Use {@link Queue.runWorker}
   * rather than calling this directly.
   *
   * @internal
   */
  static start(queue: NativeQueue, params: WorkerStartParams): Worker {
    const { tasks, queueLimits, serializer, codecs, middleware, emitter, resources, run } = params;

    // Dashboard-tunable state: per-task middleware disables are re-read on
    // every invocation (live toggles); task/queue overrides apply here, at
    // worker startup.
    const disables = new MiddlewareDisableStore(queue);
    const middlewareFor = (taskName: string): readonly Middleware[] => {
      const disabled = disables.getFor(taskName);
      if (disabled.length === 0) {
        return middleware;
      }
      return middleware.filter((mw, index) => !disabled.includes(middlewareKey(mw, index)));
    };

    // Advance workflow runs as node-jobs settle, unless disabled or unsupported.
    const tracker = (run?.advanceWorkflows ?? true) ? (params.workflowTracker ?? null) : null;

    const taskCallback = async (invocation: JsTaskInvocation): Promise<Buffer> => {
      // Built-in workflow cache-return: echo the single (cached) arg as the result.
      if (invocation.taskName === CACHE_TASK) {
        const [value] = deserializeCall(serializer, invocation.payload);
        return Buffer.from(serializer.serialize(value));
      }
      const task = tasks.get(invocation.taskName);
      if (!task) {
        throw new TaskNotRegisteredError(invocation.taskName);
      }
      // Reverse the task's named codecs (see `TaskOptions.codecs`) before decode.
      let payload: Uint8Array = invocation.payload;
      for (const codecName of [...(task.options?.codecs ?? [])].reverse()) {
        const codec = codecs?.get(codecName);
        if (!codec) {
          throw new SerializationError(`no codec registered named "${codecName}"`);
        }
        payload = codec.decode(payload);
      }
      const args = deserializeCall(serializer, payload);
      const ctx: TaskContext = { jobId: invocation.id, taskName: invocation.taskName, args };
      // Resolve the middleware chain BEFORE allocating the cancel poller and
      // task scope — it reads storage and may throw, and nothing would clean
      // those up yet.
      const chain = middlewareFor(invocation.taskName);

      // Cooperative cancel signal + job context exposed to the handler.
      const controller = new AbortController();
      const context: JobContext = {
        jobId: invocation.id,
        signal: controller.signal,
        setProgress: (progress) => queue.updateProgress(invocation.id, progress),
        publish: (value) =>
          queue.writeTaskLog(
            invocation.id,
            invocation.taskName,
            "result",
            "",
            JSON.stringify(value),
          ),
      };
      const poller = setInterval(() => {
        try {
          if (queue.isCancelRequested(invocation.id)) {
            controller.abort();
          }
        } catch (error) {
          // transient storage error — retry on the next tick
          log.debug(() => `cancel poll for ${invocation.id} failed`, error);
        }
      }, CANCEL_POLL_INTERVAL_MS);
      poller.unref();

      // Per-invocation resource scope; `useResource`/`inject` resolve against it.
      const scope = resources.createTaskScope();
      const invoke = async (): Promise<unknown> => {
        const inject = task.options?.inject;
        if (inject && inject.length > 0) {
          const deps: Record<string, unknown> = {};
          for (const name of inject) {
            deps[name] = await scope.resolver(name);
          }
          return task.handler(...args, deps);
        }
        return task.handler(...args);
      };

      try {
        for (const mw of chain) {
          await mw.before?.(ctx);
        }
        const result = await runWithResolver(scope.resolver, () => runInContext(context, invoke));
        for (const mw of chain) {
          await mw.after?.(ctx, result);
        }
        return Buffer.from(serializer.serialize(result));
      } catch (error) {
        for (const mw of chain) {
          try {
            await mw.onError?.(ctx, error);
          } catch {
            // onError hooks must not mask the original task failure.
          }
        }
        // Rethrow as the canonical structured-error JSON. With an empty name,
        // Error#toString() is just the message, so the native layer stores the
        // bare JSON object as the job's error string.
        const structured = new Error(encodeTaskError(error));
        structured.name = "";
        throw structured;
      } finally {
        clearInterval(poller);
        try {
          await scope.teardown();
        } catch (error) {
          // dispose errors must not fail an already-settled job
          log.debug(() => `task-scope teardown for ${invocation.id} failed`, error);
        }
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
      for (const mw of middlewareFor(outcome.taskName)) {
        const hook = mw[mapping.hook] as ((e: OutcomeEvent) => void) | undefined;
        try {
          // Promise.resolve captures async hooks' rejections too.
          void Promise.resolve(hook?.(event)).catch((error) => {
            log.debug(() => `${mapping.hook} middleware hook rejected for ${outcome.jobId}`, error);
          });
        } catch (error) {
          // outcome hook errors must not break the worker
          log.debug(() => `${mapping.hook} middleware hook threw for ${outcome.jobId}`, error);
        }
      }
      tracker?.onOutcome(outcome);
    };

    const nativeOptions: NativeWorkerOptions = {
      queues: run?.queues,
      channelCapacity: run?.channelCapacity,
      concurrency: run?.concurrency,
      batchSize: run?.batchSize,
      taskConfigs: applyTaskOverrides(
        buildTaskConfigs(tasks),
        tasks.keys(),
        new OverridesStore(queue),
      ),
      queueConfigs: applyQueueOverrides(buildQueueConfigs(queueLimits), new OverridesStore(queue)),
      resources: resources.isEmpty ? undefined : resources.names,
      mesh: run?.mesh,
    };
    const native = queue.runWorker(taskCallback, outcomeCallback, nativeOptions);
    // Lease the shared resource runtime only once the native worker actually
    // started, so its worker-scoped values survive until the last worker on this
    // queue stops (see ResourceRuntime). A failed start leaks no lease.
    // The lease also starts the runtime's shared health checker (first lease
    // only) — recreation of failing resources is per runtime, not per worker.
    resources.acquireWorker();

    // Register this worker's topic subscriptions (ephemeral ones under its id)
    // now that the id exists. Registration is idempotent, so a failed flush is
    // retried whole on every heartbeat tick until it succeeds — a silently
    // missing subscription would drop deliveries for the worker's lifetime.
    const flushSubscriptions = params.declareSubscriptions;
    let subscriptionsDeclared = flushSubscriptions === undefined;
    let declarationInFlight = false;
    const declareSubscriptions = (): void => {
      if (subscriptionsDeclared || declarationInFlight || !flushSubscriptions) {
        return;
      }
      declarationInFlight = true;
      void flushSubscriptions(native.id)
        .then(() => {
          subscriptionsDeclared = true;
        })
        .catch((error) => {
          log.error(() => "subscription registration failed; retrying on next heartbeat", error);
        })
        .finally(() => {
          declarationInFlight = false;
        });
    };

    // Heartbeat with current resource health so inspection (and dead-worker
    // reaping) see this worker as alive. Failures are logged, never thrown —
    // the next beat retries. First beat goes out immediately.
    const sendHeartbeat = (): void => {
      const snapshot = resources.healthSnapshot();
      void queue.workerHeartbeat(native.id, snapshot && JSON.stringify(snapshot)).catch((error) => {
        log.debug(() => "worker heartbeat failed", error);
      });
      // Same cadence, same reaper election: passing this worker's id gates the
      // sweep so only the leader runs it. Per-tick failures are swallowed like
      // the heartbeat's — the next beat retries.
      void queue.reapEphemeralSubscriptions(native.id).catch((error) => {
        log.debug(() => "ephemeral subscription reap failed", error);
      });
      declareSubscriptions();
    };
    sendHeartbeat();
    const heartbeat = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
    heartbeat.unref();

    return new Worker(native, queue, resources, heartbeat);
  }

  /** Stop the worker; in-flight results drain before background tasks exit. */
  stop(): void {
    // One last sweep for orphaned ephemeral subscriptions before this worker's
    // reap cadence goes away. Best effort — stopping must never throw.
    void this.queue.reapEphemeralSubscriptions().catch((error) => {
      log.debug(() => "final ephemeral subscription reap failed", error);
    });
    clearInterval(this.heartbeat);
    this.native.stop();
    // Dispose worker-scoped resources after the native worker quiesces (the
    // teardown drains the runtime's health checker before touching caches).
    // Best effort: lazy resources mean this is a no-op when none were built.
    void this.resources.teardownWorker().catch((error) => {
      log.debug(() => "worker-scope resource teardown failed", error);
    });
  }
}

/** Collect per-task configs that actually set something. */
function buildTaskConfigs(tasks: ReadonlyMap<string, RegisteredTask>): TaskConfigInput[] {
  const configs: TaskConfigInput[] = [];
  for (const [name, task] of tasks) {
    if (!task.options) {
      continue;
    }
    const config = toTaskConfig(name, task.options);
    if (setsSomething(config)) {
      configs.push(config);
    }
  }
  return configs;
}

function toTaskConfig(name: string, options: TaskOptions): TaskConfigInput {
  return {
    name,
    maxRetries: options.maxRetries,
    retryBaseDelayMs: options.retryBackoff?.baseMs,
    retryMaxDelayMs: options.retryBackoff?.maxMs,
    maxConcurrent: options.maxConcurrent,
    maxInFlightPerTask: options.maxInFlightPerTask,
    rateLimit: options.rateLimit,
    retryBudget: options.retryBudget,
    circuitBreaker: options.circuitBreaker,
  };
}

/**
 * Whether a task set any policy worth registering.
 *
 * Derived from the built config rather than a hand-listed set of option names:
 * a list silently drops any option missing from it, so a task setting only the
 * new option would never reach the scheduler — with no error, and invisible to
 * type-checking. `name` is always present, so it can't stand in for a setting.
 */
function setsSomething({ name: _name, ...policy }: TaskConfigInput): boolean {
  return Object.values(policy).some((value) => value !== undefined);
}

function buildQueueConfigs(limits: ReadonlyMap<string, QueueLimits>): QueueConfigInput[] {
  return [...limits].map(([name, limit]) => ({
    name,
    maxConcurrent: limit.maxConcurrent,
    rateLimit: limit.rateLimit,
  }));
}
