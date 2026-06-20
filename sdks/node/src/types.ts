export type { EnqueueOptions, JsJob as Job, WorkerOptions } from "./native";

/**
 * A registered task: receives the deserialized positional args and returns a
 * (possibly async) result.
 */
export type TaskHandler<Args extends unknown[] = unknown[], Result = unknown> = (
  ...args: Args
) => Result | Promise<Result>;
