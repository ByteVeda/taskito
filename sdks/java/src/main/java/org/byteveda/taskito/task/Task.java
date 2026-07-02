package org.byteveda.taskito.task;

import com.fasterxml.jackson.core.type.TypeReference;
import java.lang.reflect.Type;
import java.time.Duration;
import java.util.Arrays;
import java.util.List;
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
    private final RetryPolicy retryPolicy;
    private final List<String> codecs;

    private Task(String name, Type payloadType, EnqueueOptions options, RetryPolicy retryPolicy, List<String> codecs) {
        this.name = Objects.requireNonNull(name, "task name must not be null");
        if (name.trim().isEmpty()) {
            throw new IllegalArgumentException("task name must not be blank");
        }
        this.payloadType = Objects.requireNonNull(payloadType, "payloadType must not be null");
        this.options = Objects.requireNonNull(options, "options must not be null");
        this.retryPolicy = retryPolicy;
        this.codecs = List.copyOf(codecs);
    }

    /** A task whose payload deserializes to {@code payloadType}. */
    public static <T> Task<T> of(String name, Class<T> payloadType) {
        return new Task<>(name, payloadType, EnqueueOptions.none(), null, List.of());
    }

    /** A task whose payload deserializes to a generic type, e.g. {@code new TypeReference<List<Foo>>(){}}. */
    public static <T> Task<T> of(String name, TypeReference<T> payloadType) {
        return new Task<>(name, payloadType.getType(), EnqueueOptions.none(), null, List.of());
    }

    /** A copy of this task with the given default options. */
    public Task<T> withOptions(EnqueueOptions options) {
        return new Task<>(name, payloadType, options, retryPolicy, codecs);
    }

    /**
     * A copy of this task whose retries use {@code retryPolicy}'s backoff curve.
     * Registered with the worker on {@code start()}; the retry budget still comes
     * from {@link #maxRetries}.
     */
    public Task<T> retryPolicy(RetryPolicy retryPolicy) {
        return new Task<>(name, payloadType, options, retryPolicy, codecs);
    }

    /**
     * A copy of this task whose payload is passed through the named {@link
     * org.byteveda.taskito.serialization.PayloadCodec}s (in order on enqueue,
     * reversed on the worker). Each name must be registered via
     * {@code Taskito.builder().codec(name, codec)} on producers and workers.
     */
    public Task<T> codecs(String... codecs) {
        return new Task<>(name, payloadType, options, retryPolicy, Arrays.asList(codecs));
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

    /** Alias of {@link #maxRetries} in the guide's vocabulary. */
    public Task<T> retries(int retries) {
        return maxRetries(retries);
    }

    public Task<T> timeoutMs(long timeoutMs) {
        return withOptions(options.toBuilder().timeoutMs(timeoutMs).build());
    }

    public Task<T> timeout(Duration timeout) {
        return timeoutMs(timeout.toMillis());
    }

    public Task<T> delayMs(long delayMs) {
        return withOptions(options.toBuilder().delayMs(delayMs).build());
    }

    public Task<T> delay(Duration delay) {
        return delayMs(delay.toMillis());
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

    /** The retry-backoff curve for this task, or {@code null} for the core defaults. */
    public RetryPolicy retryPolicy() {
        return retryPolicy;
    }

    /** Names of the payload codecs applied to this task (empty if none). */
    public List<String> codecNames() {
        return codecs;
    }
}
