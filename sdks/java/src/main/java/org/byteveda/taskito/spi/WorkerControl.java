package org.byteveda.taskito.spi;

/** Controls a running worker and completes its in-flight jobs. */
public interface WorkerControl extends AutoCloseable {
    void completeJob(long token, byte[] result);

    void failJob(long token, String error);

    void cancelJob(long token);

    /** Stop the scheduler and heartbeat loops; in-flight jobs drain. */
    void stop();

    @Override
    void close();
}
