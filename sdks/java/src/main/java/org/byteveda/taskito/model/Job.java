package org.byteveda.taskito.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

/** Immutable view of a job. Timestamps are Unix milliseconds. */
@JsonIgnoreProperties(ignoreUnknown = true)
public final class Job {
    public final String id;
    public final String queue;
    public final String taskName;
    public final JobStatus status;
    public final int priority;
    public final long createdAt;
    public final long scheduledAt;
    public final Long startedAt;
    public final Long completedAt;
    public final int retryCount;
    public final int maxRetries;
    public final long timeoutMs;
    public final Integer progress;
    public final String error;
    public final String uniqueKey;
    public final String namespace;

    @JsonCreator
    public Job(
            @JsonProperty("id") String id,
            @JsonProperty("queue") String queue,
            @JsonProperty("taskName") String taskName,
            @JsonProperty("status") JobStatus status,
            @JsonProperty("priority") int priority,
            @JsonProperty("createdAt") long createdAt,
            @JsonProperty("scheduledAt") long scheduledAt,
            @JsonProperty("startedAt") Long startedAt,
            @JsonProperty("completedAt") Long completedAt,
            @JsonProperty("retryCount") int retryCount,
            @JsonProperty("maxRetries") int maxRetries,
            @JsonProperty("timeoutMs") long timeoutMs,
            @JsonProperty("progress") Integer progress,
            @JsonProperty("error") String error,
            @JsonProperty("uniqueKey") String uniqueKey,
            @JsonProperty("namespace") String namespace) {
        this.id = id;
        this.queue = queue;
        this.taskName = taskName;
        this.status = status;
        this.priority = priority;
        this.createdAt = createdAt;
        this.scheduledAt = scheduledAt;
        this.startedAt = startedAt;
        this.completedAt = completedAt;
        this.retryCount = retryCount;
        this.maxRetries = maxRetries;
        this.timeoutMs = timeoutMs;
        this.progress = progress;
        this.error = error;
        this.uniqueKey = uniqueKey;
        this.namespace = namespace;
    }
}
