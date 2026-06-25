package org.byteveda.taskito.spi;

/**
 * Callbacks the worker runtime invokes (on native threads). The SDK implements
 * this to run tasks and surface outcomes.
 *
 * <p>{@code onJob} must return promptly — hand the work to an executor and
 * complete it later via {@link WorkerControl}. {@code onOutcome} reports a
 * finished job for events/middleware.
 */
public interface WorkerBridge {
    void onJob(long token, String jobId, String taskName, byte[] payload);

    void onOutcome(String kind, String jobId, String taskName, String error, int retryCount, boolean timedOut);
}
