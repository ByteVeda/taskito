import type { OutcomeEvent } from "./events";
import type { EnqueueOptions } from "./native";

/** Context for a task as it executes on a worker. */
export interface TaskContext {
  jobId: string;
  taskName: string;
  args: unknown[];
}

/**
 * Context for a job being enqueued, passed to {@link Middleware.onEnqueue} before
 * serialization. Mutate `args`/`options` in place to validate, redact, or rewrite
 * the job; throw to abort the enqueue.
 */
export interface EnqueueContext {
  readonly taskName: string;
  /** Positional args, mutable before they are serialized. */
  args: unknown[];
  /** Enqueue options, mutable before they reach the core. */
  options: EnqueueOptions;
}

/**
 * Cross-cutting hooks around task execution and job outcomes. Register with
 * {@link Queue.use}. `onEnqueue` runs (sync) on the enqueuing side before
 * serialization; `before`/`after`/`onError` wrap execution (awaited, counted
 * toward the timeout); the outcome hooks fire after the core decides the result.
 */
export interface Middleware {
  onEnqueue?(ctx: EnqueueContext): void;
  before?(ctx: TaskContext): void | Promise<void>;
  after?(ctx: TaskContext, result: unknown): void | Promise<void>;
  onError?(ctx: TaskContext, error: unknown): void | Promise<void>;
  onCompleted?(event: OutcomeEvent): void;
  onRetry?(event: OutcomeEvent): void;
  onDeadLetter?(event: OutcomeEvent): void;
  onCancel?(event: OutcomeEvent): void;
}
