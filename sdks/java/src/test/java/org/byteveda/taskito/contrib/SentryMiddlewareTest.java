package org.byteveda.taskito.contrib;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;

import org.byteveda.taskito.events.EventName;
import org.byteveda.taskito.events.OutcomeEvent;
import org.byteveda.taskito.middleware.TaskContext;
import org.junit.jupiter.api.Test;

class SentryMiddlewareTest {

    @Test
    void safeNoOpWhenSentryNotInitialized() {
        SentryMiddleware middleware = new SentryMiddleware();
        // With no Sentry.init(...), the hooks must not break the worker.
        assertDoesNotThrow(() -> middleware.onError(new TaskContext("j", "t"), new RuntimeException("x")));
        assertDoesNotThrow(() -> middleware.onDeadLetter(new OutcomeEvent(EventName.DEAD, "j", "t", "err", 0, false)));
    }

    @Test
    void filterSkipsUnreportedTasks() {
        SentryMiddleware middleware = new SentryMiddleware(task -> task.equals("included"));
        assertDoesNotThrow(() -> middleware.onError(new TaskContext("j", "excluded"), new RuntimeException("x")));
    }
}
