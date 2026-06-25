package org.byteveda.taskito;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Path;
import java.util.Collections;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class QueueTest {

    private static final Task<Map<String, String>> SEND_EMAIL = Task.of("send_email", mapType());

    @SuppressWarnings("unchecked")
    private static Class<Map<String, String>> mapType() {
        return (Class<Map<String, String>>) (Class<?>) Map.class;
    }

    private Queue open(Path dir) {
        return Taskito.builder().backend("sqlite").url(dir.resolve("t.db").toString()).open();
    }

    @Test
    void enqueueGetCancelStats(@TempDir Path dir) {
        try (Queue queue = open(dir)) {
            String id = queue.enqueue(
                    SEND_EMAIL,
                    Collections.singletonMap("to", "a@b.c"),
                    EnqueueOptions.builder().priority(5).queue("emails").build());
            assertFalse(id.isEmpty());

            Optional<Job> job = queue.getJob(id);
            assertTrue(job.isPresent());
            assertEquals("send_email", job.get().taskName);
            assertEquals(JobStatus.PENDING, job.get().status);
            assertEquals(5, job.get().priority);
            assertEquals("emails", job.get().queue);

            assertEquals(1, queue.stats().pending);

            assertTrue(queue.cancel(id));
            assertEquals(0, queue.stats().pending);
        }
    }

    @Test
    void getMissingJobIsEmpty(@TempDir Path dir) {
        try (Queue queue = open(dir)) {
            assertTrue(queue.getJob("nope").isEmpty());
        }
    }
}
