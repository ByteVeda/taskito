package org.byteveda.taskito.task;

import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Objects;

/**
 * A task's retry-backoff curve: how long to wait between attempts.
 *
 * <p>The retry <em>budget</em> (how many attempts) is set per enqueue via
 * {@link Task#maxRetries}. The core scheduler owns retry execution, so retries
 * stay durable, survive worker crashes, and behave identically to the other
 * Taskito SDKs — this type only supplies the timing the scheduler applies.
 *
 * <p>Instances are immutable. Unset fields fall back to the core defaults
 * (1s base, 5min cap, exponential).
 */
public final class RetryPolicy {
    private final Duration baseDelay;
    private final Duration maxDelay;
    private final List<Duration> customDelays;

    private RetryPolicy(Duration baseDelay, Duration maxDelay, List<Duration> customDelays) {
        this.baseDelay = baseDelay;
        this.maxDelay = maxDelay;
        this.customDelays = customDelays;
    }

    /** Exponential backoff starting at {@code base}, doubling, capped at {@code max}. */
    public static RetryPolicy exponential(Duration base, Duration max) {
        return new RetryPolicy(nonNegative(base, "base"), nonNegative(max, "max"), Collections.emptyList());
    }

    /** A constant delay before every retry. */
    public static RetryPolicy fixed(Duration delay) {
        nonNegative(delay, "delay");
        return new RetryPolicy(delay, delay, Collections.emptyList());
    }

    /**
     * Explicit per-attempt delays: retry N waits {@code delays[N]}, with the last
     * value repeating once the list is exhausted. Overrides exponential backoff.
     */
    public static RetryPolicy delays(Duration... delays) {
        if (delays.length == 0) {
            throw new IllegalArgumentException("at least one delay is required");
        }
        List<Duration> copy = new ArrayList<>(delays.length);
        for (Duration delay : delays) {
            copy.add(nonNegative(delay, "delay"));
        }
        return new RetryPolicy(null, null, Collections.unmodifiableList(copy));
    }

    /** Exponential base delay, or {@code null} when using {@link #delays}. */
    public Duration baseDelay() {
        return baseDelay;
    }

    /** Backoff cap, or {@code null} when using {@link #delays}. */
    public Duration maxDelay() {
        return maxDelay;
    }

    /** Explicit per-attempt delays, or an empty list when using exponential backoff. */
    public List<Duration> customDelays() {
        return customDelays;
    }

    private static Duration nonNegative(Duration value, String what) {
        Objects.requireNonNull(value, what + " must not be null");
        if (value.isNegative()) {
            throw new IllegalArgumentException(what + " must not be negative");
        }
        return value;
    }
}
