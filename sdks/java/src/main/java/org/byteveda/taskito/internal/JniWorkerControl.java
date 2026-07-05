package org.byteveda.taskito.internal;

import java.util.Optional;
import java.util.concurrent.locks.ReentrantReadWriteLock;
import java.util.function.Supplier;
import org.byteveda.taskito.spi.WorkerControl;

/**
 * JNI-backed {@link WorkerControl} over a native worker handle.
 *
 * <p>The native contract forbids using a handle after {@code close()} or closing
 * concurrently with a call — violating it is a use-after-free in the native
 * layer. Every call therefore holds the read lock while touching the handle;
 * {@code close()} takes the write lock, so it waits out in-flight calls and any
 * later call fails with {@link IllegalStateException} instead of crashing the JVM.
 */
public final class JniWorkerControl implements WorkerControl {
    private final long handle;
    private final ReentrantReadWriteLock stateLock = new ReentrantReadWriteLock();
    private boolean closed; // guarded by stateLock

    JniWorkerControl(long handle) {
        this.handle = handle;
    }

    private <T> T withOpenHandle(Supplier<T> nativeCall) {
        stateLock.readLock().lock();
        try {
            if (closed) {
                throw new IllegalStateException("worker control is closed");
            }
            return nativeCall.get();
        } finally {
            stateLock.readLock().unlock();
        }
    }

    @Override
    public void completeJob(long token, byte[] result) {
        withOpenHandle(() -> {
            NativeWorker.completeJob(handle, token, result);
            return null;
        });
    }

    @Override
    public void failJob(long token, String error) {
        withOpenHandle(() -> {
            NativeWorker.failJob(handle, token, error);
            return null;
        });
    }

    @Override
    public void cancelJob(long token) {
        withOpenHandle(() -> {
            NativeWorker.cancelJob(handle, token);
            return null;
        });
    }

    @Override
    public void stop() {
        withOpenHandle(() -> {
            NativeWorker.stop(handle);
            return null;
        });
    }

    @Override
    public Optional<String> meshClusterInfoJson() {
        return withOpenHandle(() -> Optional.ofNullable(NativeWorker.meshClusterInfo(handle)));
    }

    /** Idempotent: frees the native worker handle exactly once, after in-flight calls drain. */
    @Override
    public void close() {
        stateLock.writeLock().lock();
        try {
            if (!closed) {
                closed = true;
                NativeWorker.close(handle);
            }
        } finally {
            stateLock.writeLock().unlock();
        }
    }
}
