package org.byteveda.taskito.internal;

import java.util.Optional;
import org.byteveda.taskito.spi.QueueBackend;

/** JNI-backed {@link QueueBackend} over a native queue handle. */
public final class JniQueueBackend implements QueueBackend {
    private final long handle;

    private JniQueueBackend(long handle) {
        this.handle = handle;
    }

    /** Open a native backend from its JSON options. */
    public static JniQueueBackend open(String optionsJson) {
        return new JniQueueBackend(NativeQueue.open(optionsJson));
    }

    @Override
    public String enqueue(String taskName, byte[] payload, String optionsJson) {
        return NativeQueue.enqueue(handle, taskName, payload, optionsJson);
    }

    @Override
    public Optional<String> getJobJson(String jobId) {
        return Optional.ofNullable(NativeQueue.getJob(handle, jobId));
    }

    @Override
    public boolean cancel(String jobId) {
        return NativeQueue.cancel(handle, jobId);
    }

    @Override
    public String statsJson() {
        return NativeQueue.stats(handle);
    }

    @Override
    public void close() {
        NativeQueue.close(handle);
    }
}
