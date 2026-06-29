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
    public final String fanOut;
    public final String fanIn;
    public final GateConfig gate;

    private Step(Builder builder) {
        this.name = builder.name;
        this.taskName = builder.taskName;
        this.payload = builder.payload;
        this.after = Collections.unmodifiableList(new ArrayList<>(builder.after));
        this.queue = builder.queue;
        this.maxRetries = builder.maxRetries;
        this.timeoutMs = builder.timeoutMs;
        this.priority = builder.priority;
        this.fanOut = builder.fanOut;
        this.fanIn = builder.fanIn;
        this.gate = builder.gate;
    }

    /** Begin a step bound to a typed task. */
    public static <T> Builder of(String name, Task<T> task, T payload) {
        return new Builder(name, task.name(), payload);
    }

    /** Begin a step bound to a task name (untyped payload). */
    public static Builder of(String name, String taskName, Object payload) {
        return new Builder(name, taskName, payload);
    }

    /** Begin a payload-less step (its payload is derived at runtime — fan-out/fan-in). */
    public static Builder of(String name, Task<?> task) {
        return new Builder(name, task.name(), null);
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
        private String fanOut;
        private String fanIn;
        private GateConfig gate;

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

        /** Run this step once per item of its predecessor's result (strategy {@code "each"}). */
        public Builder fanOut(String strategy) {
            this.fanOut = strategy;
            return this;
        }

        /** Run this step once per predecessor item using a {@link FanMode}. */
        public Builder fanOut(FanMode mode) {
            return fanOut(mode.wire());
        }

        /** Collect a fan-out predecessor's child results into one list (strategy {@code "all"}). */
        public Builder fanIn(String strategy) {
            this.fanIn = strategy;
            return this;
        }

        /** Collect a fan-out predecessor's results using a {@link FanMode}. */
        public Builder fanIn(FanMode mode) {
            return fanIn(mode.wire());
        }

        /**
         * Park this step for approval before it runs. The node waits until
         * {@code Worker.approveGate}/{@code rejectGate}, or until the gate's
         * timeout elapses.
         */
        public Builder gate(GateConfig gate) {
            this.gate = gate;
            return this;
        }

        public Step build() {
            if (fanOut != null && fanIn != null) {
                throw new IllegalArgumentException("step '" + name + "' cannot be both fan-out and fan-in");
            }
            if (gate != null && (fanOut != null || fanIn != null)) {
                throw new IllegalArgumentException("step '" + name + "' cannot be both a gate and a fan-out/fan-in");
            }
            // A gate is a deferred control node (its task never enqueues), valid only
            // on the Workflow.gate(...) sentinel — not on a normal task step.
            if (gate != null && !Workflow.GATE_TASK.equals(taskName)) {
                throw new IllegalArgumentException("step '" + name
                        + "': a gate may only be created via Workflow.gate(...); a gate on a normal task step "
                        + "would defer the node and never enqueue its task");
            }
            return new Step(this);
        }
    }
}
