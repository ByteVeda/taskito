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
