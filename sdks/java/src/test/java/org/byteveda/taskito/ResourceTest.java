package org.byteveda.taskito;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Path;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.byteveda.taskito.errors.ResourceException;
import org.byteveda.taskito.resources.ResourceScope;
import org.byteveda.taskito.resources.ResourceStat;
import org.byteveda.taskito.resources.Resources;
import org.byteveda.taskito.task.Task;
import org.byteveda.taskito.worker.Worker;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.api.io.TempDir;

class ResourceTest {

    private static final Task<Integer> TASK = Task.of("res.task", Integer.class);

    @Test
    @Timeout(30)
    void workerResourceSharedTaskResourcePerInvocation(@TempDir Path dir) throws Exception {
        int jobs = 3;
        AtomicInteger taskDisposed = new AtomicInteger();
        try (Taskito queue =
                Taskito.builder().url(dir.resolve("r.db").toString()).open()) {
            queue.resource("shared", ctx -> new Object()); // WORKER scope (default): built once
            queue.resource("perTask", ResourceScope.TASK, ctx -> new Object(), value -> taskDisposed.incrementAndGet());

            CountDownLatch ran = new CountDownLatch(jobs);
            try (Worker worker = queue.worker()
                    .handle(TASK, p -> {
                        Resources.use("shared");
                        Resources.use("perTask");
                        ran.countDown();
                        return p;
                    })
                    .start()) {
                for (int i = 0; i < jobs; i++) {
                    queue.enqueue(TASK, i);
                }
                assertTrue(ran.await(20, TimeUnit.SECONDS), "handlers did not all run");
            } // worker close drains in-flight tasks, so every teardown has run

            Map<String, ResourceStat> metrics = queue.resourceMetrics();
            assertEquals(1, metrics.get("shared").created(), "worker resource built once");
            assertEquals(jobs, metrics.get("perTask").created(), "task resource built per invocation");
            assertEquals(jobs, metrics.get("perTask").disposed(), "task resource disposed per invocation");
            assertEquals(jobs, taskDisposed.get());
        }
    }

    @Test
    void useOutsideTaskThrows() {
        assertThrows(ResourceException.class, () -> Resources.use("anything"));
    }
}
