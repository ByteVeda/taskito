package org.byteveda.taskito;

import java.util.UUID;
import org.byteveda.taskito.spi.QueueBackend;

/**
 * A distributed, TTL-bounded advisory lock. Owner-scoped to a per-instance id, so
 * only this {@code Lock} can release or extend what it acquired. {@link #close()}
 * releases it (use try-with-resources).
 */
public final class Lock implements AutoCloseable {
    private final QueueBackend backend;
    private final String name;
    private final String ownerId = UUID.randomUUID().toString();
    private final long ttlMs;
    private boolean held;

    Lock(QueueBackend backend, String name, long ttlMs) {
        this.backend = backend;
        this.name = name;
        this.ttlMs = ttlMs;
    }

    /** Try to acquire; false if another owner holds a live lock. */
    public boolean acquire() {
        held = backend.acquireLock(name, ownerId, ttlMs);
        return held;
    }

    /** Extend the TTL if still held; false otherwise. */
    public boolean extend(long ttlMs) {
        return backend.extendLock(name, ownerId, ttlMs);
    }

    public boolean isHeld() {
        return held;
    }

    public void release() {
        if (held) {
            backend.releaseLock(name, ownerId);
            held = false;
        }
    }

    @Override
    public void close() {
        release();
    }
}
