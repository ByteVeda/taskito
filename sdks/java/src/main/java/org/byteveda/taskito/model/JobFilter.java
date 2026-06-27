package org.byteveda.taskito.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;

/** Immutable filter for {@link org.byteveda.taskito.Queue#listJobs(JobFilter)}. Unset fields are ignored. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public final class JobFilter {
    @JsonProperty("status")
    private final String status;

    @JsonProperty("queue")
    private final String queue;

    @JsonProperty("task")
    private final String task;

    @JsonProperty("limit")
    private final Integer limit;

    @JsonProperty("offset")
    private final Integer offset;

    private JobFilter(Builder b) {
        this.status = b.status;
        this.queue = b.queue;
        this.task = b.task;
        this.limit = b.limit;
        this.offset = b.offset;
    }

    public static JobFilter all() {
        return builder().build();
    }

    public static Builder builder() {
        return new Builder();
    }

    public static final class Builder {
        private String status;
        private String queue;
        private String task;
        private Integer limit;
        private Integer offset;

        /** Lowercase wire status: pending/running/complete/failed/dead/cancelled. */
        public Builder status(JobStatus status) {
            this.status = status.wire();
            return this;
        }

        public Builder queue(String queue) {
            this.queue = queue;
            return this;
        }

        public Builder task(String task) {
            this.task = task;
            return this;
        }

        public Builder limit(int limit) {
            this.limit = limit;
            return this;
        }

        public Builder offset(int offset) {
            this.offset = offset;
            return this;
        }

        public JobFilter build() {
            return new JobFilter(this);
        }
    }
}
