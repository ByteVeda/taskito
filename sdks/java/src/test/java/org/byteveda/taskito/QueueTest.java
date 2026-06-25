package org.byteveda.taskito;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Path;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
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

    @Test
    void enqueueManyAndFilteredList(@TempDir Path dir) {
        try (Queue queue = open(dir)) {
            List<String> ids = queue.enqueueMany(
                    SEND_EMAIL.withOptions(EnqueueOptions.builder().queue("emails").build()),
                    Arrays.asList(
                            Collections.singletonMap("to", "a"),
                            Collections.singletonMap("to", "b"),
                            Collections.singletonMap("to", "c")));
            assertEquals(3, ids.size());
            assertEquals(3, queue.statsByQueue("emails").pending);

            List<Job> jobs = queue.listJobs(
                    JobFilter.builder().queue("emails").status(JobStatus.PENDING).build());
            assertEquals(3, jobs.size());
        }
    }

    @Test
    void settingsRoundTrip(@TempDir Path dir) {
        try (Queue queue = open(dir)) {
            queue.setSetting("theme", "dark");
            assertEquals("dark", queue.getSetting("theme").orElse(""));
            assertEquals("dark", queue.listSettings().get("theme"));
            assertTrue(queue.deleteSetting("theme"));
            assertTrue(queue.getSetting("theme").isEmpty());
        }
    }

    @Test
    void pauseAndResumeQueue(@TempDir Path dir) {
        try (Queue queue = open(dir)) {
            queue.pauseQueue("emails");
            assertTrue(queue.listPausedQueues().contains("emails"));
            queue.resumeQueue("emails");
            assertFalse(queue.listPausedQueues().contains("emails"));
        }
    }

    @Test
    void taskLogsRoundTrip(@TempDir Path dir) {
        try (Queue queue = open(dir)) {
            String id = queue.enqueue("send_email", Collections.singletonMap("to", "a"));
            queue.writeTaskLog(id, "send_email", "info", "hello");
            List<TaskLog> logs = queue.getTaskLogs(id);
            assertEquals(1, logs.size());
            assertEquals("hello", logs.get(0).message);
        }
    }
}
