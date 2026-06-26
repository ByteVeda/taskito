package org.byteveda.taskito.test;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.time.Duration;
import java.util.concurrent.atomic.AtomicReference;
import org.byteveda.taskito.Queue;
import org.byteveda.taskito.middleware.EnqueueContext;
import org.byteveda.taskito.middleware.Middleware;
import org.byteveda.taskito.middleware.TaskContext;
import org.byteveda.taskito.task.Task;
import org.byteveda.taskito.worker.Worker;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

class MiddlewareContextTest {

    @Test
    @Timeout(20)
    void metadataTravelsAndAttributesAreShared() throws Exception {
        AtomicReference<String> afterSaw = new AtomicReference<>();
        Task<Integer> echo = Task.of("mw.echo", Integer.class);
        try (Queue queue = InMemoryTaskito.open()) {
            queue.use(new Middleware() {
                @Override
                public void onEnqueue(EnqueueContext ctx) {
                    ctx.metadata().put("trace-id", "trace-123"); // injected at enqueue
                }

                @Override
                public void before(TaskContext ctx) {
                    Object traceId = ctx.job().metadata().get("trace-id"); // read at execution
                    ctx.attributes().put("seen", traceId); // scratch shared with after()
                }

                @Override
                public void after(TaskContext ctx, Object result) {
                    afterSaw.set((String) ctx.attributes().get("seen"));
                }
            });

            String id = queue.enqueue(echo, 7);
            try (Worker worker = queue.worker().handle(echo, p -> p).start()) {
                queue.awaitJob(id, Duration.ofSeconds(10));
            }
            assertEquals("trace-123", afterSaw.get());
        }
    }
}
