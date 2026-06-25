package org.byteveda.taskito.events;

/** A finished job's outcome. {@code error} is null on success/cancel; {@code retryCount} is -1 when N/A. */
public final class OutcomeEvent {
    public final EventName name;
    public final String jobId;
    public final String taskName;
    public final String error;
    public final int retryCount;
    public final boolean timedOut;

    public OutcomeEvent(
            EventName name, String jobId, String taskName, String error, int retryCount, boolean timedOut) {
        this.name = name;
        this.jobId = jobId;
        this.taskName = taskName;
        this.error = error;
        this.retryCount = retryCount;
        this.timedOut = timedOut;
    }
}
