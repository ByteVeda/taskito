package org.byteveda.taskito.internal;

import org.byteveda.taskito.spi.WorkerControl;

/** JNI-backed {@link WorkerControl} over a native worker handle. */
public final class JniWorkerControl implements WorkerControl {
    private final long handle;

    JniWorkerControl(long handle) {
        this.handle = handle;
    }

    @Override
    public void completeJob(long token, byte[] result) {
        NativeWorker.completeJob(handle, token, result);
    }

    @Override
    public void failJob(long token, String error) {
        NativeWorker.failJob(handle, token, error);
    }

    @Override
    public void cancelJob(long token) {
        NativeWorker.cancelJob(handle, token);
    }

    @Override
    public void stop() {
        NativeWorker.stop(handle);
    }

    @Override
    public void close() {
        NativeWorker.close(handle);
    }
}
