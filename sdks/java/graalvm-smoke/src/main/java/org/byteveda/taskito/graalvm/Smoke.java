package org.byteveda.taskito.graalvm;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.byteveda.taskito.Queue;
import org.byteveda.taskito.Taskito;
import org.byteveda.taskito.events.EventName;
import org.byteveda.taskito.scheduling.PeriodicTask;
import org.byteveda.taskito.task.Task;
import org.byteveda.taskito.worker.Worker;

/**
 * Drives the SDK's JNI dispatch and Jackson (de)serialization end to end so a
 * GraalVM native image of this class proves the shipped reachability metadata is
 * complete. Exits non-zero on any failure.
 */
public final class Smoke {

    private Smoke() {}

    public static void main(String[] args) throws Exception {
        Path dir = Files.createTempDirectory("taskito-graalvm-smoke");
        Task<String> echo = Task.of("echo", String.class);

        try (Queue queue = Taskito.builder()
                .backend("sqlite")
                .url(dir.resolve("smoke.db").toString())
                .open()) {
            String id = queue.enqueue(echo, "graalvm");

            CountDownLatch done = new CountDownLatch(1);
            try (Worker worker = queue.worker()
                    .handle(echo, (String payload) -> payload.length())
                    .on(EventName.SUCCESS, event -> done.countDown())
                    .start()) {
                if (!done.await(20, TimeUnit.SECONDS)) {
                    throw new IllegalStateException("task did not complete");
                }
            }

            byte[] result = queue.getResult(id).orElseThrow(() -> new IllegalStateException("no result persisted"));
            String value = new String(result, StandardCharsets.UTF_8);
            if (!"7".equals(value)) {
                throw new IllegalStateException("unexpected result: " + value);
            }

            // Exercise the Jackson DTO paths (PeriodicInfo + DeadJob deserialization).
            queue.registerPeriodic(
                    PeriodicTask.builder("nightly", "echo", "0 0 0 * * *").build());
            if (queue.listPeriodic().isEmpty()) {
                throw new IllegalStateException("listPeriodic returned empty");
            }
            queue.listDead(10, 0);

            System.out.println("taskito graalvm smoke ok");
        }
    }
}
