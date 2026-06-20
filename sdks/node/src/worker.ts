import { TaskNotRegisteredError } from "./errors.js";
import type { JsTaskInvocation, NativeQueue, NativeWorker } from "./native.js";
import type { Serializer } from "./serializer.js";
import type { TaskHandler, WorkerOptions } from "./types.js";

/** A running worker. Hold it for the worker's lifetime; call {@link Worker.stop}. */
export class Worker {
  private constructor(private readonly native: NativeWorker) {}

  /**
   * Start a worker from a queue's task registry. Use {@link Queue.runWorker}
   * rather than calling this directly.
   *
   * @internal
   */
  static start(
    queue: NativeQueue,
    tasks: ReadonlyMap<string, TaskHandler>,
    serializer: Serializer,
    options?: WorkerOptions,
  ): Worker {
    const callback = async (invocation: JsTaskInvocation): Promise<Buffer> => {
      const handler = tasks.get(invocation.taskName);
      if (!handler) {
        throw new TaskNotRegisteredError(invocation.taskName);
      }
      const args = serializer.deserialize(invocation.payload) as unknown[];
      const result = await handler(...args);
      return Buffer.from(serializer.serialize(result));
    };
    return new Worker(queue.runWorker(callback, options));
  }

  /** Stop the worker; in-flight results drain before background tasks exit. */
  stop(): void {
    this.native.stop();
  }
}
