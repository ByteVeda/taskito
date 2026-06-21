/** Base class for all Taskito SDK errors. Every error below extends this. */
export class TaskitoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskitoError";
  }
}

// ── Tasks & jobs ────────────────────────────────────────────────────────────

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

/** Thrown by {@link Queue.result} when a job doesn't settle within the timeout. */
export class ResultTimeoutError extends TaskitoError {
  constructor(
    readonly jobId: string,
    readonly timeoutMs: number,
  ) {
    super(`timed out after ${timeoutMs}ms waiting for job ${jobId}`);
    this.name = "ResultTimeoutError";
  }
}

// ── Queue & locks ───────────────────────────────────────────────────────────

/** Thrown on queue-level configuration or operational errors. */
export class QueueError extends TaskitoError {
  constructor(message: string) {
    super(message);
    this.name = "QueueError";
  }
}

/** Thrown by {@link Queue.withLock} when the lock is held by another owner. */
export class LockNotAcquiredError extends TaskitoError {
  constructor(readonly lockName: string) {
    super(`Could not acquire lock "${lockName}"`);
    this.name = "LockNotAcquiredError";
  }
}

/** Thrown when a held lock's lease was lost before the guarded section finished. */
export class LockLostError extends TaskitoError {
  constructor(readonly lockName: string) {
    super(`Lost lock "${lockName}" before the guarded section completed`);
    this.name = "LockLostError";
  }
}

// ── Serialization & validation ──────────────────────────────────────────────

/** Thrown on serialization, deserialization, or payload-integrity failures. */
export class SerializationError extends TaskitoError {
  constructor(message: string) {
    super(message);
    this.name = "SerializationError";
  }
}

/** Thrown when a `notes` object violates the structured-notes contract. */
export class NotesValidationError extends TaskitoError {
  constructor(message: string) {
    super(message);
    this.name = "NotesValidationError";
  }
}

// ── Resources ───────────────────────────────────────────────────────────────

/** Base class for resource dependency-injection errors. */
export class ResourceError extends TaskitoError {
  constructor(message: string) {
    super(message);
    this.name = "ResourceError";
  }
}

/** Thrown when resolving a resource name that was never registered. */
export class ResourceNotFoundError extends ResourceError {
  constructor(readonly resourceName: string) {
    super(`No resource registered with name "${resourceName}"`);
    this.name = "ResourceNotFoundError";
  }
}

/** Thrown when a task-scoped resource is resolved at worker scope. */
export class ResourceScopeError extends ResourceError {
  constructor(readonly resourceName: string) {
    super(`Resource "${resourceName}" is task-scoped and cannot be resolved at worker scope`);
    this.name = "ResourceScopeError";
  }
}

// ── Workflows ───────────────────────────────────────────────────────────────

/** Thrown on workflow definition, submission, or query errors. */
export class WorkflowError extends TaskitoError {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowError";
  }
}
