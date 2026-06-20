/** Base class for all Taskito SDK errors. */
export class TaskitoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskitoError";
  }
}

/** Thrown when a worker dequeues a job whose task name was never registered. */
export class TaskNotRegisteredError extends TaskitoError {
  constructor(readonly taskName: string) {
    super(`No task registered with name "${taskName}"`);
    this.name = "TaskNotRegisteredError";
  }
}

/** Thrown by {@link Queue.result} when the awaited job failed or dead-lettered. */
export class JobFailedError extends TaskitoError {
  constructor(
    readonly jobId: string,
    reason: string,
  ) {
    super(`Job ${jobId} failed: ${reason}`);
    this.name = "JobFailedError";
  }
}

/** Thrown by {@link Queue.result} when the awaited job was cancelled. */
export class JobCancelledError extends TaskitoError {
  constructor(readonly jobId: string) {
    super(`Job ${jobId} was cancelled`);
    this.name = "JobCancelledError";
  }
}

/** Thrown by {@link Queue.withLock} when the lock is held by another owner. */
export class LockNotAcquiredError extends TaskitoError {
  constructor(readonly lockName: string) {
    super(`Could not acquire lock "${lockName}"`);
    this.name = "LockNotAcquiredError";
  }
}
