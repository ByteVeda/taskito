package org.byteveda.taskito;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.byteveda.taskito.events.EventName;
import org.byteveda.taskito.task.Task;
import org.byteveda.taskito.worker.Worker;
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
        try (Queue queue = Taskito.builder()
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
}
