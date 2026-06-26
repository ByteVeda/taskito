package org.byteveda.taskito.middleware;

import java.util.HashMap;
import java.util.Map;

/**
 * Identifies a task as it executes on a worker. {@link #attributes()} is a
 * per-execution scratch map shared across {@code before}/{@code after}/
 * {@code onError} for the same job; {@link #job()} exposes its metadata.
 */
public final class TaskContext {
    public final String jobId;
    public final String taskName;

    private final Map<String, Object> attributes = new HashMap<>();
    private final JobInfo job;

    public TaskContext(String jobId, String taskName, JobInfo job) {
        this.jobId = jobId;
        this.taskName = taskName;
        this.job = job;
    }

    public TaskContext(String jobId, String taskName) {
        this(jobId, taskName, new JobInfo(jobId, taskName, java.util.Collections::emptyMap));
    }

    /** Mutable per-execution scratch shared across this job's middleware hooks. */
    public Map<String, Object> attributes() {
        return attributes;
    }

    /** The executing job, including its (lazily loaded) metadata. */
    public JobInfo job() {
        return job;
    }
}
