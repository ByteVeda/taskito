package org.byteveda.taskito.workflows;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

/** A node's state within a workflow run. Timestamps are Unix milliseconds; nullable when unset. */
@JsonIgnoreProperties(ignoreUnknown = true)
public final class NodeSnapshot {
    public final String nodeName;
    public final NodeStatus status;
    public final String jobId;
    public final String resultHash;
    public final Integer fanOutCount;
    public final Long startedAt;
    public final Long completedAt;
    public final String error;

    @JsonCreator
    public NodeSnapshot(
            @JsonProperty("nodeName") String nodeName,
            @JsonProperty("status") NodeStatus status,
            @JsonProperty("jobId") String jobId,
            @JsonProperty("resultHash") String resultHash,
            @JsonProperty("fanOutCount") Integer fanOutCount,
            @JsonProperty("startedAt") Long startedAt,
            @JsonProperty("completedAt") Long completedAt,
            @JsonProperty("error") String error) {
        this.nodeName = nodeName;
        this.status = status;
        this.jobId = jobId;
        this.resultHash = resultHash;
        this.fanOutCount = fanOutCount;
        this.startedAt = startedAt;
        this.completedAt = completedAt;
        this.error = error;
    }
}
