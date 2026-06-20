/** Job lifecycle events emitted from a worker's outcome stream. */
export type EventName = "job.completed" | "job.retrying" | "job.dead" | "job.cancelled";

/** Payload for a job lifecycle event. */
export interface OutcomeEvent {
  jobId: string;
  taskName: string;
  queue?: string;
  error?: string;
  retryCount?: number;
  timedOut?: boolean;
}

export type EventHandler = (event: OutcomeEvent) => void;

/** A minimal typed event emitter. Listener errors are isolated. */
export class Emitter {
  private readonly handlers = new Map<EventName, Set<EventHandler>>();

  on(event: EventName, handler: EventHandler): void {
    const set = this.handlers.get(event) ?? new Set<EventHandler>();
    set.add(handler);
    this.handlers.set(event, set);
  }

  off(event: EventName, handler: EventHandler): void {
    this.handlers.get(event)?.delete(handler);
  }

  emit(event: EventName, payload: OutcomeEvent): void {
    const set = this.handlers.get(event);
    if (!set) {
      return;
    }
    for (const handler of set) {
      try {
        handler(payload);
      } catch {
        // A listener throwing must not break other listeners or the worker.
      }
    }
  }
}
