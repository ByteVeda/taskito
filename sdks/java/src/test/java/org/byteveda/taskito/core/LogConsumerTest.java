package org.byteveda.taskito.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.BooleanSupplier;
import org.byteveda.taskito.Taskito;
import org.byteveda.taskito.pubsub.LogConsumerOptions;
import org.byteveda.taskito.worker.Worker;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.api.io.TempDir;

/**
 * S28 managed log consumer: a daemon thread pulls a log topic's cursor, invokes the
 * handler per message, and advances the cursor. The core cursor algorithm is
 * unit-tested in Rust; these drive the Java poll loop and its {@code onError} policy
 * end-to-end. Consumers are registered before the worker starts; assertions poll an
 * aggregate collection rather than rendezvous between threads.
 */
class LogConsumerTest {

    private Taskito open(Path dir) {
        return Taskito.builder()
                .backend("sqlite")
                .url(dir.resolve("t.db").toString())
                .open();
    }

    @Test
    @Timeout(30)
    void consumerInvokesHandlerAndAdvancesCursor(@TempDir Path dir) throws Exception {
        List<String> received = new CopyOnWriteArrayList<>();
        try (Taskito queue = open(dir)) {
            queue.logConsumer("events", "worker", String.class, received::add);
            queue.publish("events", "a");
            queue.publish("events", "b");
            queue.publish("events", "c");

            try (Worker worker = queue.worker().start()) {
                pollUntil(Duration.ofSeconds(20), () -> received.size() == 3);
                assertEquals(List.of("a", "b", "c"), received);
                // Every handled message is acked, so the cursor catches up (lag 0).
                pollUntil(Duration.ofSeconds(5), () -> lag(queue) == 0);
                assertEquals(0, lag(queue));
            }
        }
    }

    @Test
    @Timeout(30)
    void retryReReadsFailedMessageButNotAckedPredecessor(@TempDir Path dir) throws Exception {
        List<String> received = new CopyOnWriteArrayList<>();
        try (Taskito queue = open(dir)) {
            queue.logConsumer(
                    "events",
                    "worker",
                    String.class,
                    value -> {
                        received.add(value);
                        if (value.equals("boom")) {
                            throw new IllegalStateException("handler blew up");
                        }
                    },
                    LogConsumerOptions.builder()
                            .pollIntervalMs(50)
                            .onError("retry")
                            .build());
            queue.publish("events", "ok");
            queue.publish("events", "boom");
            queue.publish("events", "after");

            try (Worker worker = queue.worker().start()) {
                // retry never acks past the failure, so "boom" re-reads every poll.
                pollUntil(Duration.ofSeconds(20), () -> count(received, "boom") >= 3);
                assertEquals(1, count(received, "ok"), "the acked predecessor is not redelivered");
                assertEquals(0, count(received, "after"), "the poison blocks the rest of the batch");
            }
        }
    }

    @Test
    @Timeout(30)
    void skipAcksPastPoisonMessage(@TempDir Path dir) throws Exception {
        List<String> received = new CopyOnWriteArrayList<>();
        try (Taskito queue = open(dir)) {
            queue.logConsumer(
                    "events",
                    "worker",
                    String.class,
                    value -> {
                        received.add(value);
                        if (value.equals("boom")) {
                            throw new IllegalStateException("handler blew up");
                        }
                    },
                    LogConsumerOptions.builder()
                            .pollIntervalMs(50)
                            .onError("skip")
                            .build());
            queue.publish("events", "ok");
            queue.publish("events", "boom");
            queue.publish("events", "after");

            try (Worker worker = queue.worker().start()) {
                pollUntil(Duration.ofSeconds(20), () -> received.contains("after"));
                pollUntil(Duration.ofSeconds(5), () -> lag(queue) == 0);
                // skip acks past the poison, so it runs once and the batch drains fully.
                assertEquals(List.of("ok", "boom", "after"), received);
            }
        }
    }

    private static long lag(Taskito queue) {
        List<org.byteveda.taskito.model.TopicLogStat> stats = queue.topicLogStats();
        assertEquals(1, stats.size());
        return stats.get(0).lag;
    }

    private static long count(List<String> values, String target) {
        return values.stream().filter(target::equals).count();
    }

    private static void pollUntil(Duration timeout, BooleanSupplier condition) throws InterruptedException {
        long deadline = System.nanoTime() + timeout.toNanos();
        while (System.nanoTime() < deadline && !condition.getAsBoolean()) {
            Thread.sleep(25);
        }
        // Fail rather than silently return, so each caller's condition is asserted.
        assertTrue(condition.getAsBoolean(), "condition not met within " + timeout);
    }
}
