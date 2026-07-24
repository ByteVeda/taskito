package org.byteveda.taskito.events;

/**
 * An enqueue was rejected by a predicate or enqueue gate
 * ({@link EventName#PREDICATE_REJECTED}). Emitted before the rejection is thrown
 * to the caller.
 *
 * @param taskName the task whose enqueue was rejected
 * @param reason the rejection reason; null when the gate gave none
 */
public record PredicateEvent(String taskName, String reason) implements TaskitoEvent {

    @Override
    public EventName name() {
        return EventName.PREDICATE_REJECTED;
    }
}
