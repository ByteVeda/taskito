package org.byteveda.taskito.events;

/**
 * An event emitted by the runtime — job outcomes, enqueues, worker lifecycle,
 * queue pause/resume, workflow lifecycle, and predicate rejections. Subscribe by
 * {@link EventName} via {@code Taskito.onEvent} (queue-level) or
 * {@code Worker.Builder.onEvent} (one worker), then narrow to the concrete type.
 */
public sealed interface TaskitoEvent
        permits OutcomeEvent,
                EnqueuedEvent,
                WorkerEvent,
                QueueEvent,
                WorkflowEvent,
                GateEvent,
                NodeCompensationEvent,
                PredicateEvent {

    /** Which event this is; determines the concrete type and the listeners it reaches. */
    EventName name();
}
