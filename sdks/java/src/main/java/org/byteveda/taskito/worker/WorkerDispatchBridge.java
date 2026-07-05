package org.byteveda.taskito.worker;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import org.byteveda.taskito.events.Emitter;
import org.byteveda.taskito.events.EventName;
import org.byteveda.taskito.events.OutcomeEvent;
import org.byteveda.taskito.logging.TaskitoLogger;
import org.byteveda.taskito.middleware.JobInfo;
import org.byteveda.taskito.middleware.Middleware;
import org.byteveda.taskito.middleware.TaskContext;
import org.byteveda.taskito.resources.ResourceRuntime;
import org.byteveda.taskito.resources.Resources;
import org.byteveda.taskito.resources.TaskScope;
import org.byteveda.taskito.serialization.PayloadCodec;
import org.byteveda.taskito.serialization.Serializer;
import org.byteveda.taskito.spi.QueueBackend;
import org.byteveda.taskito.spi.WorkerBridge;
import org.byteveda.taskito.spi.WorkerControl;

/**
 * Bridges native job dispatch to registered handlers. {@code onJob} hands work to
 * an executor, runs middleware around the handler, and completes via the
 * {@link WorkerControl}; {@code onOutcome} fans finished jobs out to middleware
 * and event listeners.
 */
final class WorkerDispatchBridge implements WorkerBridge {
    private static final TaskitoLogger LOG = TaskitoLogger.create("worker");
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final TypeReference<Map<String, Object>> MAP = new TypeReference<Map<String, Object>>() {};

    private final QueueBackend backend;
    private final Map<String, RegisteredTask> handlers;
    private final Serializer serializer;
    private final ExecutorService executor;
    private final Emitter emitter;
    private final List<Middleware> middleware;
    private final ResourceRuntime resources;
    private final Map<String, PayloadCodec> codecs;
    // Resolved once startWorker returns; job tasks await it before completing.
    private final CompletableFuture<WorkerControl> control = new CompletableFuture<>();

    WorkerDispatchBridge(
            QueueBackend backend,
            Map<String, RegisteredTask> handlers,
            Serializer serializer,
            ExecutorService executor,
            Emitter emitter,
            List<Middleware> middleware,
            ResourceRuntime resources,
            Map<String, PayloadCodec> codecs) {
        this.backend = backend;
        this.handlers = handlers;
        this.serializer = serializer;
        this.executor = executor;
        this.emitter = emitter;
        this.middleware = middleware;
        this.resources = resources;
        this.codecs = codecs;
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
        JobInfo job = new JobInfo(jobId, taskName, () -> loadMetadata(jobId));
        TaskContext context = new TaskContext(jobId, taskName, job);
        // Bind a per-task resource scope around the handler; skip all wiring when
        // no resources are registered (zero overhead for the common case).
        TaskScope scope = resources.isEmpty() ? null : resources.createTaskScope();
        if (scope != null) {
            Resources.enter(scope);
        }
        try {
            for (Middleware m : middleware) {
                m.before(context);
            }
            Object argument = serializer.deserialize(decodePayload(payload, task.codecs), task.payloadType);
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
        } finally {
            if (scope != null) {
                Resources.exit(scope); // unbind the thread + dispose task-scoped resources (LIFO)
            }
        }
    }

    /** Reverse a task's payload codecs (last applied, first undone). */
    private byte[] decodePayload(byte[] payload, List<String> codecNames) {
        byte[] bytes = payload;
        for (int i = codecNames.size() - 1; i >= 0; i--) {
            String name = codecNames.get(i);
            PayloadCodec codec = codecs.get(name);
            if (codec == null) {
                throw new IllegalStateException("no codec registered named '" + name + "'");
            }
            bytes = codec.decode(bytes);
        }
        return bytes;
    }

    @Override
    public void onOutcome(String kind, String jobId, String taskName, String error, int retryCount, boolean timedOut) {
        EventName name = EventName.fromKind(kind);
        OutcomeEvent event = new OutcomeEvent(name, jobId, taskName, error, retryCount, timedOut);
        emitter.emit(event);
        for (Middleware m : middleware) {
            try {
                dispatch(m, name, event);
            } catch (RuntimeException e) {
                // One faulty middleware must not starve the rest of this outcome.
                LOG.warn("middleware " + m.getClass().getName() + " threw on " + name + " (job " + jobId + ")", e);
            }
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

    /** Lazily load a job's metadata blob into a map (empty on absence/parse failure). */
    private Map<String, Object> loadMetadata(String jobId) {
        try {
            JsonNode view = backend.getJobJson(jobId)
                    .map(WorkerDispatchBridge::readTree)
                    .orElse(null);
            JsonNode blob = view == null ? null : view.get("metadata");
            if (blob == null || blob.isNull()) {
                return Collections.emptyMap();
            }
            String json = blob.asText();
            return json.isEmpty() ? Collections.emptyMap() : JSON.readValue(json, MAP);
        } catch (Exception e) {
            return Collections.emptyMap();
        }
    }

    private static JsonNode readTree(String json) {
        try {
            return JSON.readTree(json);
        } catch (Exception e) {
            return null;
        }
    }

    private static String describe(Throwable t) {
        String message = t.getMessage();
        return message == null ? t.getClass().getSimpleName() : t.getClass().getSimpleName() + ": " + message;
    }
}
