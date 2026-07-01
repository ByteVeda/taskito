package org.byteveda.taskito;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Path;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.byteveda.taskito.errors.InterceptionException;
import org.byteveda.taskito.interception.Interception;
import org.byteveda.taskito.task.Task;
import org.byteveda.taskito.worker.Worker;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.api.io.TempDir;

class InterceptionTest {

    private static final Task<Integer> A = Task.of("ic.a", Integer.class);
    private static final Task<Integer> B = Task.of("ic.b", Integer.class);

    @Test
    @Timeout(30)
    void convertsPayload(@TempDir Path dir) throws Exception {
        try (Taskito queue =
                Taskito.builder().url(dir.resolve("ic.db").toString()).open()) {
            queue.intercept((task, payload) -> Interception.convert((Integer) payload * 10));
            AtomicInteger seen = new AtomicInteger();
            CountDownLatch ran = new CountDownLatch(1);
            try (Worker worker = queue.worker()
                    .handle(A, p -> {
                        seen.set(p);
                        ran.countDown();
                        return p;
                    })
                    .start()) {
                queue.enqueue(A, 5);
                assertTrue(ran.await(20, TimeUnit.SECONDS));
                assertEquals(50, seen.get());
            }
        }
    }

    @Test
    @Timeout(30)
    void redirectsTask(@TempDir Path dir) throws Exception {
        try (Taskito queue =
                Taskito.builder().url(dir.resolve("ic.db").toString()).open()) {
            queue.intercept((task, payload) ->
                    task.equals("ic.a") ? Interception.redirect("ic.b", payload) : Interception.pass());
            AtomicInteger aRan = new AtomicInteger();
            CountDownLatch bRan = new CountDownLatch(1);
            try (Worker worker = queue.worker()
                    .handle(A, p -> aRan.incrementAndGet())
                    .handle(B, p -> {
                        bRan.countDown();
                        return p;
                    })
                    .start()) {
                queue.enqueue(A, 1);
                assertTrue(bRan.await(20, TimeUnit.SECONDS));
                assertEquals(0, aRan.get());
            }
        }
    }

    @Test
    void rejectsEnqueue(@TempDir Path dir) {
        try (Taskito queue =
                Taskito.builder().url(dir.resolve("ic.db").toString()).open()) {
            queue.intercept((task, payload) -> Interception.reject("blocked"));
            assertThrows(InterceptionException.class, () -> queue.enqueue(A, 1));
        }
    }

    @Test
    void rejectsNullInterceptorResult(@TempDir Path dir) {
        try (Taskito queue =
                Taskito.builder().url(dir.resolve("ic.db").toString()).open()) {
            queue.intercept((task, payload) -> null);
            assertThrows(InterceptionException.class, () -> queue.enqueue(A, 1));
        }
    }
}
