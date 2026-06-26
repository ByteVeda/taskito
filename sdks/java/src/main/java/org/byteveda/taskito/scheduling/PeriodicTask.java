package org.byteveda.taskito.scheduling;

/** A cron-scheduled task registration. The worker enqueues it when due. */
public final class PeriodicTask {
    public final String name;
    public final String taskName;
    public final String cron;
    public final Object payload;
    public final String queue;
    public final String timezone;
    public final boolean enabled;

    private PeriodicTask(Builder b) {
        this.name = b.name;
        this.taskName = b.taskName;
        this.cron = b.cron;
        this.payload = b.payload;
        this.queue = b.queue;
        this.timezone = b.timezone;
        this.enabled = b.enabled;
    }

    public static Builder builder(String name, String taskName, String cron) {
        return new Builder(name, taskName, cron);
    }

    public static final class Builder {
        private final String name;
        private final String taskName;
        private final String cron;
        private Object payload;
        private String queue;
        private String timezone;
        private boolean enabled = true;

        Builder(String name, String taskName, String cron) {
            this.name = name;
            this.taskName = taskName;
            this.cron = cron;
        }

        public Builder payload(Object payload) {
            this.payload = payload;
            return this;
        }

        public Builder queue(String queue) {
            this.queue = queue;
            return this;
        }

        public Builder timezone(String timezone) {
            this.timezone = timezone;
            return this;
        }

        public Builder enabled(boolean enabled) {
            this.enabled = enabled;
            return this;
        }

        public PeriodicTask build() {
            return new PeriodicTask(this);
        }
    }
}
