package org.byteveda.taskito.events;

import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Consumer;

/** Dispatches {@link OutcomeEvent}s to registered listeners. Thread-safe. */
public final class Emitter {
    private final Map<EventName, List<Consumer<OutcomeEvent>>> listeners = new EnumMap<>(EventName.class);

    public void on(EventName name, Consumer<OutcomeEvent> listener) {
        listeners.computeIfAbsent(name, key -> new CopyOnWriteArrayList<>()).add(listener);
    }

    /** Deliver {@code event} to its listeners; a throwing listener never blocks the rest. */
    public void emit(OutcomeEvent event) {
        List<Consumer<OutcomeEvent>> bound = listeners.get(event.name);
        if (bound == null) {
            return;
        }
        for (Consumer<OutcomeEvent> listener : bound) {
            try {
                listener.accept(event);
            } catch (RuntimeException ignored) {
                // A listener fault must not break event dispatch.
            }
        }
    }
}
