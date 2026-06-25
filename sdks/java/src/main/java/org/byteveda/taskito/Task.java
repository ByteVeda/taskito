package org.byteveda.taskito;

/** Typed task descriptor: a name, its payload type, and default enqueue options. */
public final class Task<T> {
    private final String name;
    private final Class<T> payloadType;
    private final EnqueueOptions options;

    private Task(String name, Class<T> payloadType, EnqueueOptions options) {
        this.name = name;
        this.payloadType = payloadType;
        this.options = options;
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
