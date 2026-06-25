package org.byteveda.taskito.middleware;

/** Identifies a task as it executes on a worker. */
public final class TaskContext {
    public final String jobId;
    public final String taskName;

    public TaskContext(String jobId, String taskName) {
        this.jobId = jobId;
        this.taskName = taskName;
    }
}
