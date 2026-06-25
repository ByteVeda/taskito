package org.byteveda.taskito.middleware;

import org.byteveda.taskito.EnqueueOptions;

/**
 * A job being enqueued, passed to {@link Middleware#onEnqueue} before
 * serialization. Replace the payload or options to rewrite the job; throw to
 * abort the enqueue.
 */
public final class EnqueueContext {
    public final String taskName;
    private Object payload;
    private EnqueueOptions options;

    public EnqueueContext(String taskName, Object payload, EnqueueOptions options) {
        this.taskName = taskName;
        this.payload = payload;
        this.options = options;
    }

    public Object payload() {
        return payload;
    }

    public void payload(Object payload) {
        this.payload = payload;
    }

    public EnqueueOptions options() {
        return options;
    }

    public void options(EnqueueOptions options) {
        this.options = options;
    }
}
