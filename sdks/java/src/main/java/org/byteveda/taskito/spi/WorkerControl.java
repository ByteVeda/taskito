package org.byteveda.taskito.spi;

import java.util.Optional;

/** Controls a running worker and completes its in-flight jobs. */
public interface WorkerControl extends AutoCloseable {
    void completeJob(long token, byte[] result);

    /** Fail a job. {@code retryable} false dead-letters it whatever budget is left. */
    void failJob(long token, String error, boolean retryable);

    void cancelJob(long token);

    /** Stop the scheduler and heartbeat loops; in-flight jobs drain. */
    void stop();

    /** A JSON {@code ClusterInfo} snapshot when mesh is enabled, else empty. */
    default Optional<String> meshClusterInfoJson() {
        return Optional.empty();
    }

    @Override
    void close();
}
