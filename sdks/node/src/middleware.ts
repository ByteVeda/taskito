import type { OutcomeEvent } from "./events";

/** Context for a task as it executes on a worker. */
export interface TaskContext {
  jobId: string;
  taskName: string;
  args: unknown[];
}

/**
 * Cross-cutting hooks around task execution and job outcomes. Register with
 * {@link Queue.use}. `before`/`after`/`onError` wrap execution (awaited, counted
 * toward the timeout); the outcome hooks fire after the core decides the result.
 */
export interface Middleware {
  before?(ctx: TaskContext): void | Promise<void>;
  after?(ctx: TaskContext, result: unknown): void | Promise<void>;
  onError?(ctx: TaskContext, error: unknown): void | Promise<void>;
  onCompleted?(event: OutcomeEvent): void;
  onRetry?(event: OutcomeEvent): void;
  onDeadLetter?(event: OutcomeEvent): void;
  onCancel?(event: OutcomeEvent): void;
}
