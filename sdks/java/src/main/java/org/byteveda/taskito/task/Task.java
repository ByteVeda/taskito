package org.byteveda.taskito.task;

import com.fasterxml.jackson.core.type.TypeReference;
import java.lang.reflect.Type;
import java.util.Objects;

/**
 * Typed task descriptor: a name, its payload type, and default enqueue options.
 *
 * <p>For generic payloads (e.g. {@code Map<String, Object>}) use the
 * {@link TypeReference} factory, which {@code Class} tokens cannot express.
 * The fluent option methods each return a new descriptor (the type is immutable).
 */
public final class Task<T> {
    private final String name;
    private final Type payloadType;
    private final EnqueueOptions options;

    private Task(String name, Type payloadType, EnqueueOptions options) {
        this.name = Objects.requireNonNull(name, "task name must not be null");
        if (name.trim().isEmpty()) {
            throw new IllegalArgumentException("task name must not be blank");
        }
        this.payloadType = Objects.requireNonNull(payloadType, "payloadType must not be null");
        this.options = Objects.requireNonNull(options, "options must not be null");
    }

    /** A task whose payload deserializes to {@code payloadType}. */
    public static <T> Task<T> of(String name, Class<T> payloadType) {
        return new Task<>(name, payloadType, EnqueueOptions.none());
    }

    /** A task whose payload deserializes to a generic type, e.g. {@code new TypeReference<List<Foo>>(){}}. */
    public static <T> Task<T> of(String name, TypeReference<T> payloadType) {
        return new Task<>(name, payloadType.getType(), EnqueueOptions.none());
    }

    /** A copy of this task with the given default options. */
    public Task<T> withOptions(EnqueueOptions options) {
        return new Task<>(name, payloadType, options);
    }

    public Task<T> queue(String queue) {
        return withOptions(options.toBuilder().queue(queue).build());
    }

    public Task<T> priority(int priority) {
        return withOptions(options.toBuilder().priority(priority).build());
    }

    public Task<T> maxRetries(int maxRetries) {
        return withOptions(options.toBuilder().maxRetries(maxRetries).build());
    }

    public Task<T> timeoutMs(long timeoutMs) {
        return withOptions(options.toBuilder().timeoutMs(timeoutMs).build());
    }

    public Task<T> delayMs(long delayMs) {
        return withOptions(options.toBuilder().delayMs(delayMs).build());
    }

    public String name() {
        return name;
    }

    /** The payload type — a {@code Class} or a generic {@code Type} from a {@link TypeReference}. */
    public Type payloadType() {
        return payloadType;
    }

    public EnqueueOptions options() {
        return options;
    }
}
