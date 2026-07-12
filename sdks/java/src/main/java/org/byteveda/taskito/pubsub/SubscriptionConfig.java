package org.byteveda.taskito.pubsub;

/**
 * A resolved subscription declaration recorded by {@code Taskito.subscribe(...)}.
 * Workers register these at start (ephemeral entries bind to the started
 * worker's id), and {@code publish(...)} reads the task delivery defaults so
 * deliveries honor each subscriber's own settings.
 */
public final class SubscriptionConfig {
    private final String topic;
    private final String name;
    private final String taskName;
    private final String queue;
    private final boolean durable;
    private final Integer taskPriority;
    private final Integer taskMaxRetries;
    private final Long taskTimeoutMs;

    public SubscriptionConfig(
            String topic,
            String name,
            String taskName,
            String queue,
            boolean durable,
            Integer taskPriority,
            Integer taskMaxRetries,
            Long taskTimeoutMs) {
        this.topic = topic;
        this.name = name;
        this.taskName = taskName;
        this.queue = queue;
        this.durable = durable;
        this.taskPriority = taskPriority;
        this.taskMaxRetries = taskMaxRetries;
        this.taskTimeoutMs = taskTimeoutMs;
    }

    public String topic() {
        return topic;
    }

    public String name() {
        return name;
    }

    public String taskName() {
        return taskName;
    }

    public String queue() {
        return queue;
    }

    public boolean durable() {
        return durable;
    }

    /** The subscriber task's default priority, or {@code null} for the core default. */
    public Integer taskPriority() {
        return taskPriority;
    }

    /** The subscriber task's default retry budget, or {@code null} for the core default. */
    public Integer taskMaxRetries() {
        return taskMaxRetries;
    }

    /** The subscriber task's default timeout, or {@code null} for the core default. */
    public Long taskTimeoutMs() {
        return taskTimeoutMs;
    }
}
