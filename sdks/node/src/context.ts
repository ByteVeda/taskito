import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Ambient context available to a running task via {@link currentJob}. Mirrors
 * the Python shell's `current_job`.
 */
export interface JobContext {
  /** The running job's id. */
  readonly jobId: string;
  /** Aborts when cancellation is requested — check `signal.aborted` or listen. */
  readonly signal: AbortSignal;
  /** Report progress (0–100) for observability. */
  setProgress(progress: number): void;
}

const store = new AsyncLocalStorage<JobContext>();

/** The context of the task running on this async stack, or `undefined`. */
export function currentJob(): JobContext | undefined {
  return store.getStore();
}

/** Run `fn` with `context` bound as the ambient job context. @internal */
export function runInContext<T>(context: JobContext, fn: () => T): T {
  return store.run(context, fn);
}
