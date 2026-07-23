package org.byteveda.taskito.worker;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import org.byteveda.taskito.Taskito;
import org.byteveda.taskito.events.EventName;
import org.byteveda.taskito.events.OutcomeEvent;
import org.byteveda.taskito.middleware.Middleware;
import org.byteveda.taskito.middleware.TaskContext;
import org.byteveda.taskito.task.Task;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.api.io.TempDir;

class WorkerTest {

    @SuppressWarnings("unchecked")
    private static Class<Map<String, Object>> mapType() {
        return (Class<Map<String, Object>>) (Class<?>) Map.class;
    }

    @Test
    @Timeout(30)
    void runsTaskToCompletion(@TempDir Path dir) throws Exception {
        Task<Map<String, Object>> add = Task.of("add", mapType());
        try (Taskito queue = Taskito.builder()
                .backend("sqlite")
                .url(dir.resolve("t.db").toString())
                .open()) {
            Map<String, Object> payload = new HashMap<>();
            payload.put("a", 2);
            payload.put("b", 3);
            String id = queue.enqueue(add, payload);

            CountDownLatch done = new CountDownLatch(1);
            try (Worker worker = queue.worker()
                    .handle(
                            add,
                            (Map<String, Object> p) ->
                                    ((Number) p.get("a")).intValue() + ((Number) p.get("b")).intValue())
                    .on(EventName.SUCCESS, event -> done.countDown())
                    .start()) {
                assertTrue(done.await(20, TimeUnit.SECONDS), "task should complete");

                Optional<byte[]> result = queue.getResult(id);
                assertTrue(result.isPresent());
                assertEquals("5", new String(result.get(), StandardCharsets.UTF_8));
            }
        }
    }

    @Test
    @Timeout(30)
    void middlewareFaultDoesNotStarveOthers(@TempDir Path dir) throws Exception {
        Task<Map<String, Object>> noop = Task.of("noop", mapType());
        try (Taskito queue = Taskito.builder()
                .backend("sqlite")
                .url(dir.resolve("t.db").toString())
                .open()) {
            CountDownLatch secondSaw = new CountDownLatch(1);
            queue.use(new Middleware() {
                @Override
                public void onCompleted(OutcomeEvent event) {
                    throw new IllegalStateException("boom");
                }
            });
            queue.use(new Middleware() {
                @Override
                public void onCompleted(OutcomeEvent event) {
                    secondSaw.countDown();
                }
            });
            queue.enqueue(noop, new HashMap<>());
            try (Worker worker = queue.worker().handle(noop, p -> "ok").start()) {
                assertTrue(secondSaw.await(20, TimeUnit.SECONDS), "second middleware must still see the outcome");
            }
        }
    }

    @Test
    @Timeout(30)
    void reportsHowLongTheTaskRan(@TempDir Path dir) throws Exception {
        Task<Map<String, Object>> slow = Task.of("slow", mapType());
        try (Taskito queue = Taskito.builder()
                .backend("sqlite")
                .url(dir.resolve("t.db").toString())
                .open()) {
            AtomicLong middlewareElapsed = new AtomicLong(-1);
            queue.use(new Middleware() {
                @Override
                public void after(TaskContext context, Object result) {
                    middlewareElapsed.set(context.elapsedMs());
                }
            });
            queue.enqueue(slow, new HashMap<>());

            CountDownLatch done = new CountDownLatch(1);
            AtomicReference<OutcomeEvent> outcome = new AtomicReference<>();
            try (Worker worker = queue.worker()
                    .handle(slow, p -> {
                        Thread.sleep(60);
                        return "ok";
                    })
                    .on(EventName.SUCCESS, event -> {
                        outcome.set(event);
                        done.countDown();
                    })
                    .start()) {
                assertTrue(done.await(20, TimeUnit.SECONDS), "task should complete");
            }

            // Both clocks measure a run that slept 60ms; allow for timer jitter.
            Long duration = outcome.get().durationMs();
            assertNotNull(duration, "a job the worker ran must report its duration");
            assertTrue(duration >= 50, "outcome duration was " + duration + "ms");
            assertTrue(middlewareElapsed.get() >= 50, "middleware elapsed was " + middlewareElapsed.get() + "ms");
        }
    }
}
