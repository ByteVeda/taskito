package org.byteveda.taskito;

import java.util.Objects;

/** Typed task descriptor: a name, its payload type, and default enqueue options. */
public final class Task<T> {
    private final String name;
    private final Class<T> payloadType;
    private final EnqueueOptions options;

    private Task(String name, Class<T> payloadType, EnqueueOptions options) {
        this.name = Objects.requireNonNull(name, "task name must not be null");
        if (name.trim().isEmpty()) {
            throw new IllegalArgumentException("task name must not be blank");
        }
        this.payloadType = Objects.requireNonNull(payloadType, "payloadType must not be null");
        this.options = Objects.requireNonNull(options, "options must not be null");
    }

    public static <T> Task<T> of(String name, Class<T> payloadType) {
        return new Task<>(name, payloadType, EnqueueOptions.none());
    }

    /** A copy of this task with the given default options. */
    public Task<T> withOptions(EnqueueOptions options) {
        return new Task<>(name, payloadType, options);
    }

    public String name() {
        return name;
    }

    public Class<T> payloadType() {
        return payloadType;
    }

    public EnqueueOptions options() {
        return options;
    }
}
