package org.byteveda.taskito;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotSame;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Path;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.byteveda.taskito.errors.ResourceException;
import org.byteveda.taskito.resources.ResourceScope;
import org.byteveda.taskito.resources.ResourceStat;
import org.byteveda.taskito.resources.Resources;
import org.byteveda.taskito.task.Task;
import org.byteveda.taskito.task.TaskFunction;
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

    @Test
    void duplicateRegistrationThrows(@TempDir Path dir) throws Exception {
        try (Taskito queue =
                Taskito.builder().url(dir.resolve("rdup.db").toString()).open()) {
            queue.resource("db", ctx -> new Object());
            assertThrows(ResourceException.class, () -> queue.resource("db", ctx -> new Object()));
        }
    }

    @Test
    @Timeout(30)
    void circularResourceDependencyIsRejected(@TempDir Path dir) throws Exception {
        try (Taskito queue =
                Taskito.builder().url(dir.resolve("rcyc.db").toString()).open()) {
            queue.resource("self", ctx -> {
                ctx.use("self"); // self-reference — must fail fast, not StackOverflow
                return new Object();
            });
            AtomicReference<Class<?>> thrown = new AtomicReference<>();
            CountDownLatch ran = new CountDownLatch(1);
            try (Worker worker = queue.worker()
                    .handle(TASK, p -> {
                        try {
                            Resources.use("self");
                        } catch (RuntimeException e) {
                            thrown.set(e.getClass());
                        } finally {
                            ran.countDown();
                        }
                        return p;
                    })
                    .start()) {
                queue.enqueue(TASK, 1);
                assertTrue(ran.await(20, TimeUnit.SECONDS));
            }
            assertEquals(ResourceException.class, thrown.get());
        }
    }

    @Test
    @Timeout(30)
    void threadResourceReusedAcrossSequentialTasks(@TempDir Path dir) throws Exception {
        int jobs = 2;
        AtomicInteger disposed = new AtomicInteger();
        try (Taskito queue =
                Taskito.builder().url(dir.resolve("rth.db").toString()).open()) {
            queue.resource("perThread", ResourceScope.THREAD, ctx -> new Object(), value -> disposed.incrementAndGet());
            AtomicReference<Object> first = new AtomicReference<>();
            AtomicReference<Object> second = new AtomicReference<>();
            CountDownLatch ran = new CountDownLatch(jobs);
            try (Worker worker = queue.worker()
                    .concurrency(1) // one thread → both jobs share its instance
                    .handle(TASK, p -> {
                        Object instance = Resources.use("perThread");
                        if (!first.compareAndSet(null, instance)) {
                            second.set(instance);
                        }
                        ran.countDown();
                        return p;
                    })
                    .start()) {
                for (int i = 0; i < jobs; i++) {
                    queue.enqueue(TASK, i);
                }
                assertTrue(ran.await(20, TimeUnit.SECONDS));
            } // worker close disposes thread-scoped instances

            assertSame(first.get(), second.get(), "same thread reuses its instance");
            assertEquals(1, queue.resourceMetrics().get("perThread").created());
            assertEquals(1, disposed.get(), "disposed once at worker shutdown");
        }
    }

    @Test
    @Timeout(30)
    void requestResourceFreshPerUse(@TempDir Path dir) throws Exception {
        AtomicInteger disposed = new AtomicInteger();
        try (Taskito queue =
                Taskito.builder().url(dir.resolve("rrq.db").toString()).open()) {
            queue.resource("perUse", ResourceScope.REQUEST, ctx -> new Object(), value -> disposed.incrementAndGet());
            AtomicReference<Object> a = new AtomicReference<>();
            AtomicReference<Object> b = new AtomicReference<>();
            CountDownLatch ran = new CountDownLatch(1);
            try (Worker worker = queue.worker()
                    .handle(TASK, p -> {
                        a.set(Resources.use("perUse"));
                        b.set(Resources.use("perUse"));
                        ran.countDown();
                        return p;
                    })
                    .start()) {
                queue.enqueue(TASK, 1);
                assertTrue(ran.await(20, TimeUnit.SECONDS));
            }
            assertNotSame(a.get(), b.get(), "every use builds a fresh instance");
            assertEquals(2, queue.resourceMetrics().get("perUse").created());
            assertEquals(2, disposed.get(), "both instances disposed at task end");
        }
    }

    @Test
    @Timeout(30)
    void threadFactoryCannotUseTaskScopedResource(@TempDir Path dir) throws Exception {
        try (Taskito queue =
                Taskito.builder().url(dir.resolve("rtg.db").toString()).open()) {
            queue.resource("perTask", ResourceScope.TASK, ctx -> new Object());
            queue.resource("perThread", ResourceScope.THREAD, ctx -> ctx.use("perTask"));
            AtomicReference<Class<?>> thrown = new AtomicReference<>();
            CountDownLatch ran = new CountDownLatch(1);
            try (Worker worker = queue.worker()
                    .handle(TASK, p -> {
                        try {
                            Resources.use("perThread");
                        } catch (RuntimeException e) {
                            thrown.set(e.getClass());
                        } finally {
                            ran.countDown();
                        }
                        return p;
                    })
                    .start()) {
                queue.enqueue(TASK, 1);
                assertTrue(ran.await(20, TimeUnit.SECONDS));
            }
            assertEquals(ResourceException.class, thrown.get());
        }
    }

    @Test
    @Timeout(30)
    void workerFactoryCannotUseThreadResource(@TempDir Path dir) throws Exception {
        try (Taskito queue =
                Taskito.builder().url(dir.resolve("rwg.db").toString()).open()) {
            queue.resource("perThread", ResourceScope.THREAD, ctx -> new Object());
            queue.resource("shared", ctx -> ctx.use("perThread")); // WORKER factory
            AtomicReference<Class<?>> thrown = new AtomicReference<>();
            CountDownLatch ran = new CountDownLatch(1);
            try (Worker worker = queue.worker()
                    .handle(TASK, p -> {
                        try {
                            Resources.use("shared");
                        } catch (RuntimeException e) {
                            thrown.set(e.getClass());
                        } finally {
                            ran.countDown();
                        }
                        return p;
                    })
                    .start()) {
                queue.enqueue(TASK, 1);
                assertTrue(ran.await(20, TimeUnit.SECONDS));
            }
            assertEquals(ResourceException.class, thrown.get());
        }
    }

    @Test
    @Timeout(30)
    void workerScopedResourceIsBuiltPerWorker(@TempDir Path dir) throws Exception {
        try (Taskito queue =
                Taskito.builder().url(dir.resolve("rpw.db").toString()).open()) {
            queue.resource("perWorker", ctx -> new Object());
            // Force exactly one job per worker so both live workers resolve the resource.
            CyclicBarrier bothBusy = new CyclicBarrier(2);
            CountDownLatch ran = new CountDownLatch(2);
            TaskFunction<Integer, Integer> handler = p -> {
                Resources.use("perWorker");
                bothBusy.await(20, TimeUnit.SECONDS);
                ran.countDown();
                return p;
            };
            try (Worker w1 = queue.worker().concurrency(1).handle(TASK, handler).start();
                    Worker w2 =
                            queue.worker().concurrency(1).handle(TASK, handler).start()) {
                queue.enqueue(TASK, 1);
                queue.enqueue(TASK, 2);
                assertTrue(ran.await(25, TimeUnit.SECONDS));
            }
            // Shared-runtime would build once (created==1); per-worker builds one each.
            assertEquals(2, queue.resourceMetrics().get("perWorker").created());
        }
    }
}
