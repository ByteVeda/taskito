package org.byteveda.taskito.worker;

import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import org.byteveda.taskito.events.Emitter;
import org.byteveda.taskito.events.EventName;
import org.byteveda.taskito.events.OutcomeEvent;
import org.byteveda.taskito.middleware.Middleware;
import org.byteveda.taskito.middleware.TaskContext;
import org.byteveda.taskito.serialization.Serializer;
import org.byteveda.taskito.spi.WorkerBridge;
import org.byteveda.taskito.spi.WorkerControl;

/**
 * Bridges native job dispatch to registered handlers. {@code onJob} hands work to
 * an executor, runs middleware around the handler, and completes via the
 * {@link WorkerControl}; {@code onOutcome} fans finished jobs out to middleware
 * and event listeners.
 */
final class WorkerDispatchBridge implements WorkerBridge {
    private final Map<String, RegisteredTask> handlers;
    private final Serializer serializer;
    private final ExecutorService executor;
    private final Emitter emitter;
    private final List<Middleware> middleware;
    // Resolved once startWorker returns; job tasks await it before completing.
    private final CompletableFuture<WorkerControl> control = new CompletableFuture<>();

    WorkerDispatchBridge(
            Map<String, RegisteredTask> handlers,
            Serializer serializer,
            ExecutorService executor,
            Emitter emitter,
            List<Middleware> middleware) {
        this.handlers = handlers;
        this.serializer = serializer;
        this.executor = executor;
        this.emitter = emitter;
        this.middleware = middleware;
    }

    void bind(WorkerControl control) {
        this.control.complete(control);
    }

    @Override
    public void onJob(long token, String jobId, String taskName, byte[] payload) {
        executor.execute(() -> runJob(token, jobId, taskName, payload));
    }

    private void runJob(long token, String jobId, String taskName, byte[] payload) {
        WorkerControl bound = control.join();
        RegisteredTask task = handlers.get(taskName);
        if (task == null) {
            bound.failJob(token, "no handler registered for task '" + taskName + "'");
            return;
        }
        TaskContext context = new TaskContext(jobId, taskName);
        try {
            for (Middleware m : middleware) {
                m.before(context);
            }
            Object argument = serializer.deserialize(payload, task.payloadType);
            Object result = task.handler.apply(argument);
            for (Middleware m : middleware) {
                m.after(context, result);
            }
            bound.completeJob(token, serializer.serialize(result));
        } catch (Throwable t) {
            for (Middleware m : middleware) {
                m.onError(context, t);
            }
            bound.failJob(token, describe(t));
        }
    }

    @Override
    public void onOutcome(String kind, String jobId, String taskName, String error, int retryCount, boolean timedOut) {
        EventName name = EventName.fromKind(kind);
        OutcomeEvent event = new OutcomeEvent(name, jobId, taskName, error, retryCount, timedOut);
        emitter.emit(event);
        for (Middleware m : middleware) {
            dispatch(m, name, event);
        }
    }

    private static void dispatch(Middleware m, EventName name, OutcomeEvent event) {
        switch (name) {
            case SUCCESS:
                m.onCompleted(event);
                break;
            case RETRY:
                m.onRetry(event);
                break;
            case DEAD:
                m.onDeadLetter(event);
                break;
            case CANCELLED:
                m.onCancel(event);
                break;
            default:
                break;
        }
    }

    private static String describe(Throwable t) {
        String message = t.getMessage();
        return message == null ? t.getClass().getSimpleName() : t.getClass().getSimpleName() + ": " + message;
    }
}
