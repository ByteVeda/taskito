package org.byteveda.taskito.worker;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import org.byteveda.taskito.TaskitoException;
import org.byteveda.taskito.events.Emitter;
import org.byteveda.taskito.events.EventName;
import org.byteveda.taskito.events.OutcomeEvent;
import org.byteveda.taskito.middleware.Middleware;
import org.byteveda.taskito.serialization.Serializer;
import org.byteveda.taskito.spi.QueueBackend;
import org.byteveda.taskito.spi.WorkerControl;
import org.byteveda.taskito.task.Task;
import org.byteveda.taskito.task.TaskFunction;
import org.byteveda.taskito.workflows.WorkflowTracker;

/**
 * A running worker. Build one with {@link Queue#worker()}, register handlers,
 * then {@link Builder#start()}. {@link #close()} stops it and drains in-flight
 * jobs.
 */
public final class Worker implements AutoCloseable {
    private static final long SHUTDOWN_TIMEOUT_SECONDS = 30;

    private final WorkerControl control;
    private final ExecutorService executor;
    private final CountDownLatch shutdown = new CountDownLatch(1);
    private boolean closed;

    private Worker(WorkerControl control, ExecutorService executor) {
        this.control = control;
        this.executor = executor;
    }

    public static Builder builder(QueueBackend backend, Serializer serializer, List<Middleware> middleware) {
        return new Builder(backend, serializer, middleware);
    }

    /** Stop dispatching; in-flight jobs continue to drain. */
    public void stop() {
        control.stop();
    }

    /** Block until {@link #close()} is called. */
    public void awaitShutdown() throws InterruptedException {
        shutdown.await();
    }

    /**
     * Stop dispatching, drain in-flight handler tasks, then free the native
     * worker. Draining BEFORE {@code control.close()} is essential: a running
     * handler may still call back into the native worker
     * ({@code completeJob}/{@code failJob}), so the handle must outlive every
     * handler task. Idempotent.
     */
    @Override
    public synchronized void close() {
        if (closed) {
            return;
        }
        closed = true;
        control.stop(); // stop scheduling new work
        executor.shutdown(); // stop accepting; let running handlers finish
        try {
            if (!executor.awaitTermination(SHUTDOWN_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
                executor.shutdownNow();
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            executor.shutdownNow();
        }
        control.close(); // now safe to free the native handle — no handler can touch it
        shutdown.countDown();
    }

    /** Registers handlers and worker options, then starts the worker. */
    public static final class Builder {
        private static final ObjectMapper JSON = new ObjectMapper();

        private final QueueBackend backend;
        private final Serializer serializer;
        private final List<Middleware> middleware;
        private final Map<String, RegisteredTask> handlers = new HashMap<>();
        private final Map<EventName, List<Consumer<OutcomeEvent>>> listeners = new EnumMap<>(EventName.class);
        private List<String> queues;
        private int concurrency;
        private Integer channelCapacity;
        private Integer batchSize;

        Builder(QueueBackend backend, Serializer serializer, List<Middleware> middleware) {
            this.backend = backend;
            this.serializer = serializer;
            this.middleware = middleware;
        }

        public <T, R> Builder handle(String taskName, Class<T> payloadType, TaskFunction<T, R> handler) {
            handlers.put(taskName, new RegisteredTask(payloadType, cast(handler)));
            return this;
        }

        public <T, R> Builder handle(Task<T> task, TaskFunction<T, R> handler) {
            handlers.put(task.name(), new RegisteredTask(task.payloadType(), cast(handler)));
            return this;
        }

        /** Apply a customizer to this builder (e.g. a generated {@code XxxTasks.bind}). */
        public Builder apply(Consumer<Builder> customizer) {
            customizer.accept(this);
            return this;
        }

        /** Register a single {@link Handler} (a task + its function). */
        public Builder register(Handler<?, ?> handler) {
            handlers.put(
                    handler.task().name(), new RegisteredTask(handler.task().payloadType(), cast(handler.function())));
            return this;
        }

        /** Register every handler in a {@link HandlerRegistry} (e.g. a generated {@code XxxTasks.handlers}). */
        public Builder register(HandlerRegistry registry) {
            registry.handlers().forEach(this::register);
            return this;
        }

        public Builder queues(String... queues) {
            this.queues = Arrays.asList(queues);
            return this;
        }

        /** Fixed handler-thread count; 0 (default) uses a cached pool. */
        public Builder concurrency(int concurrency) {
            this.concurrency = concurrency;
            return this;
        }

        public Builder channelCapacity(int channelCapacity) {
            this.channelCapacity = channelCapacity;
            return this;
        }

        public Builder batchSize(int batchSize) {
            this.batchSize = batchSize;
            return this;
        }

        public Builder on(EventName name, Consumer<OutcomeEvent> listener) {
            listeners.computeIfAbsent(name, key -> new ArrayList<>()).add(listener);
            return this;
        }

        /** Drive workflow node and run state from this worker's job outcomes. */
        public Builder trackWorkflows() {
            WorkflowTracker tracker = new WorkflowTracker(backend, serializer);
            on(EventName.SUCCESS, tracker::onSuccess);
            on(EventName.DEAD, tracker::onDead);
            return this;
        }

        public Worker start() {
            ExecutorService executor =
                    concurrency > 0 ? Executors.newFixedThreadPool(concurrency) : Executors.newCachedThreadPool();
            Emitter emitter = new Emitter();
            listeners.forEach((name, bound) -> bound.forEach(listener -> emitter.on(name, listener)));
            WorkerDispatchBridge bridge = new WorkerDispatchBridge(handlers, serializer, executor, emitter, middleware);
            WorkerControl control = backend.startWorker(bridge, encodeOptions());
            bridge.bind(control);
            return new Worker(control, executor);
        }

        private String encodeOptions() {
            Map<String, Object> options = new LinkedHashMap<>();
            if (queues != null) {
                options.put("queues", queues);
            }
            if (channelCapacity != null) {
                options.put("channelCapacity", channelCapacity);
            }
            if (batchSize != null) {
                options.put("batchSize", batchSize);
            }
            try {
                return JSON.writeValueAsString(options);
            } catch (Exception e) {
                throw new TaskitoException("failed to encode worker options", e);
            }
        }

        @SuppressWarnings("unchecked")
        private static <T, R> TaskFunction<Object, Object> cast(TaskFunction<T, R> handler) {
            return (TaskFunction<Object, Object>) handler;
        }
    }
}
