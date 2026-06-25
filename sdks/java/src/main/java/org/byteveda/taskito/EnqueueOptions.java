package org.byteveda.taskito;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;

/** Immutable per-enqueue options. Unset fields take core defaults. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public final class EnqueueOptions {
    @JsonProperty("queue") private final String queue;
    @JsonProperty("priority") private final Integer priority;
    @JsonProperty("maxRetries") private final Integer maxRetries;
    @JsonProperty("timeoutMs") private final Long timeoutMs;
    @JsonProperty("delayMs") private final Long delayMs;
    @JsonProperty("uniqueKey") private final String uniqueKey;
    @JsonProperty("metadata") private final String metadata;
    @JsonProperty("namespace") private final String namespace;

    private EnqueueOptions(Builder b) {
        this.queue = b.queue;
        this.priority = b.priority;
        this.maxRetries = b.maxRetries;
        this.timeoutMs = b.timeoutMs;
        this.delayMs = b.delayMs;
        this.uniqueKey = b.uniqueKey;
        this.metadata = b.metadata;
        this.namespace = b.namespace;
    }

    public static EnqueueOptions none() {
        return builder().build();
    }

    public static Builder builder() {
        return new Builder();
    }

    public static final class Builder {
        private String queue;
        private Integer priority;
        private Integer maxRetries;
        private Long timeoutMs;
        private Long delayMs;
        private String uniqueKey;
        private String metadata;
        private String namespace;

        public Builder queue(String queue) {
            this.queue = queue;
            return this;
        }

        public Builder priority(int priority) {
            this.priority = priority;
            return this;
        }

        public Builder maxRetries(int maxRetries) {
            this.maxRetries = maxRetries;
            return this;
        }

        public Builder timeoutMs(long timeoutMs) {
            this.timeoutMs = timeoutMs;
            return this;
        }

        public Builder delayMs(long delayMs) {
            this.delayMs = delayMs;
            return this;
        }

        public Builder uniqueKey(String uniqueKey) {
            this.uniqueKey = uniqueKey;
            return this;
        }

        public Builder metadata(String metadata) {
            this.metadata = metadata;
            return this;
        }

        public Builder namespace(String namespace) {
            this.namespace = namespace;
            return this;
        }

        public EnqueueOptions build() {
            return new EnqueueOptions(this);
        }
    }
}
