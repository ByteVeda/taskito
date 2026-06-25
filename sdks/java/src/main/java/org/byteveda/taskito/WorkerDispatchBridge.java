package org.byteveda.taskito;

import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import org.byteveda.taskito.events.Emitter;
import org.byteveda.taskito.events.EventName;
import org.byteveda.taskito.events.OutcomeEvent;
import org.byteveda.taskito.serialization.Serializer;
import org.byteveda.taskito.spi.WorkerBridge;
import org.byteveda.taskito.spi.WorkerControl;

/**
 * Bridges native job dispatch to registered handlers. {@code onJob} hands work to
 * an executor and completes it via the {@link WorkerControl}; {@code onOutcome}
 * fans finished jobs out to event listeners.
 */
final class WorkerDispatchBridge implements WorkerBridge {
    private final Map<String, RegisteredTask> handlers;
    private final Serializer serializer;
    private final ExecutorService executor;
    private final Emitter emitter;
    // Resolved once startWorker returns; job tasks await it before completing.
    private final CompletableFuture<WorkerControl> control = new CompletableFuture<>();

    WorkerDispatchBridge(
            Map<String, RegisteredTask> handlers,
            Serializer serializer,
            ExecutorService executor,
            Emitter emitter) {
        this.handlers = handlers;
        this.serializer = serializer;
        this.executor = executor;
        this.emitter = emitter;
    }

    void bind(WorkerControl control) {
        this.control.complete(control);
    }

    @Override
    public void onJob(long token, String jobId, String taskName, byte[] payload) {
        executor.execute(() -> runJob(token, taskName, payload));
    }

    private void runJob(long token, String taskName, byte[] payload) {
        WorkerControl bound = control.join();
        RegisteredTask task = handlers.get(taskName);
        if (task == null) {
            bound.failJob(token, "no handler registered for task '" + taskName + "'");
            return;
        }
        try {
            Object argument = serializer.deserialize(payload, task.payloadType);
            Object result = task.handler.apply(argument);
            bound.completeJob(token, serializer.serialize(result));
        } catch (Throwable t) {
            bound.failJob(token, describe(t));
        }
    }

    @Override
    public void onOutcome(String kind, String jobId, String taskName, String error, int retryCount, boolean timedOut) {
        emitter.emit(new OutcomeEvent(EventName.fromKind(kind), jobId, taskName, error, retryCount, timedOut));
    }

    private static String describe(Throwable t) {
        String message = t.getMessage();
        return message == null ? t.getClass().getSimpleName() : t.getClass().getSimpleName() + ": " + message;
    }
}
