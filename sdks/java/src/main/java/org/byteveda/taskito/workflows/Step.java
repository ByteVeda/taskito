package org.byteveda.taskito.workflows;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import org.byteveda.taskito.task.Task;

/** One step in a {@link Workflow}: a task plus its payload, predecessors, and per-step overrides. */
public final class Step {
    public final String name;
    public final String taskName;
    public final Object payload;
    public final List<String> after;
    public final String queue;
    public final Integer maxRetries;
    public final Long timeoutMs;
    public final Integer priority;

    private Step(Builder builder) {
        this.name = builder.name;
        this.taskName = builder.taskName;
        this.payload = builder.payload;
        this.after = Collections.unmodifiableList(new ArrayList<>(builder.after));
        this.queue = builder.queue;
        this.maxRetries = builder.maxRetries;
        this.timeoutMs = builder.timeoutMs;
        this.priority = builder.priority;
    }

    /** Begin a step bound to a typed task. */
    public static <T> Builder of(String name, Task<T> task, T payload) {
        return new Builder(name, task.name(), payload);
    }

    /** Begin a step bound to a task name (untyped payload). */
    public static Builder of(String name, String taskName, Object payload) {
        return new Builder(name, taskName, payload);
    }

    /** Fluent builder for a {@link Step}. */
    public static final class Builder {
        private final String name;
        private final String taskName;
        private final Object payload;
        private final List<String> after = new ArrayList<>();
        private String queue;
        private Integer maxRetries;
        private Long timeoutMs;
        private Integer priority;

        private Builder(String name, String taskName, Object payload) {
            this.name = name;
            this.taskName = taskName;
            this.payload = payload;
        }

        /** Predecessor step names that must finish before this step runs. */
        public Builder after(String... predecessors) {
            this.after.addAll(Arrays.asList(predecessors));
            return this;
        }

        public Builder queue(String queue) {
            this.queue = queue;
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

        public Builder priority(int priority) {
            this.priority = priority;
            return this;
        }

        public Step build() {
            return new Step(this);
        }
    }
}
