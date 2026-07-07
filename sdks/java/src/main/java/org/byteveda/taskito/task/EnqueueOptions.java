package org.byteveda.taskito.task;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.time.Duration;

/** Immutable per-enqueue options. Unset fields take core defaults. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public final class EnqueueOptions {
    @JsonProperty("queue")
    private final String queue;

    @JsonProperty("priority")
    private final Integer priority;

    @JsonProperty("maxRetries")
    private final Integer maxRetries;

    @JsonProperty("timeoutMs")
    private final Long timeoutMs;

    @JsonProperty("delayMs")
    private final Long delayMs;

    @JsonProperty("uniqueKey")
    private final String uniqueKey;

    @JsonProperty("metadata")
    private final String metadata;

    @JsonProperty("namespace")
    private final String namespace;

    // Idempotency inputs resolve to uniqueKey locally (see DefaultTaskito) and never cross
    // the wire, so they carry no @JsonProperty and are not serialized into the options JSON.
    private final Boolean idempotent;

    private final String idempotencyKey;

    private EnqueueOptions(Builder b) {
        this.queue = b.queue;
        this.priority = b.priority;
        this.maxRetries = b.maxRetries;
        this.timeoutMs = b.timeoutMs;
        this.delayMs = b.delayMs;
        this.uniqueKey = b.uniqueKey;
        this.metadata = b.metadata;
        this.namespace = b.namespace;
        this.idempotent = b.idempotent;
        this.idempotencyKey = b.idempotencyKey;
    }

    public static EnqueueOptions none() {
        return builder().build();
    }

    public static Builder builder() {
        return new Builder();
    }

    /** A builder seeded with this instance's values, for deriving a modified copy. */
    public Builder toBuilder() {
        Builder b = new Builder();
        b.queue = queue;
        b.priority = priority;
        b.maxRetries = maxRetries;
        b.timeoutMs = timeoutMs;
        b.delayMs = delayMs;
        b.uniqueKey = uniqueKey;
        b.metadata = metadata;
        b.namespace = namespace;
        b.idempotent = idempotent;
        b.idempotencyKey = idempotencyKey;
        return b;
    }

    /** The explicit dedup key, or {@code null} when none was set. */
    public String uniqueKey() {
        return uniqueKey;
    }

    /**
     * Tri-state idempotency toggle: {@code TRUE} forces auto-derivation of a {@code uniqueKey},
     * {@code FALSE} opts this enqueue out of a task-level default, {@code null} defers to the task.
     */
    public Boolean idempotent() {
        return idempotent;
    }

    /** An explicit idempotency key (used as the {@code uniqueKey} when set), or {@code null}. */
    public String idempotencyKey() {
        return idempotencyKey;
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
        private Boolean idempotent;
        private String idempotencyKey;

        public Builder queue(String queue) {
            this.queue = queue;
            return this;
        }

        public Builder priority(int priority) {
            this.priority = priority;
            return this;
        }

        public Builder maxRetries(int maxRetries) {
            if (maxRetries < 0) {
                throw new IllegalArgumentException("maxRetries must be >= 0");
            }
            this.maxRetries = maxRetries;
            return this;
        }

        public Builder timeoutMs(long timeoutMs) {
            if (timeoutMs < 0) {
                throw new IllegalArgumentException("timeoutMs must be >= 0");
            }
            this.timeoutMs = timeoutMs;
            return this;
        }

        public Builder delayMs(long delayMs) {
            if (delayMs < 0) {
                throw new IllegalArgumentException("delayMs must be >= 0");
            }
            this.delayMs = delayMs;
            return this;
        }

        /** Schedule the job after {@code delay} (Duration form of {@link #delayMs}). */
        public Builder delay(Duration delay) {
            this.delayMs = delay.toMillis();
            return this;
        }

        /** Per-job timeout (Duration form of {@link #timeoutMs}). */
        public Builder timeout(Duration timeout) {
            this.timeoutMs = timeout.toMillis();
            return this;
        }

        /** Idempotency key — alias of {@link #uniqueKey} in the guide's vocabulary. */
        public Builder jobId(String jobId) {
            this.uniqueKey = jobId;
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

        /**
         * Dedupe this enqueue by auto-deriving a {@code uniqueKey} from the task name and
         * payload. A duplicate enqueue is a no-op while the first job is pending or running.
         * An explicit {@link #uniqueKey}/{@link #idempotencyKey} takes precedence; passing
         * {@code false} opts out of a task-level default.
         */
        public Builder idempotent(boolean idempotent) {
            this.idempotent = idempotent;
            return this;
        }

        /** Dedupe this enqueue under an explicit key (equivalent to a caller-supplied {@code uniqueKey}). */
        public Builder idempotencyKey(String idempotencyKey) {
            this.idempotencyKey = idempotencyKey;
            return this;
        }

        public EnqueueOptions build() {
            return new EnqueueOptions(this);
        }
    }
}
