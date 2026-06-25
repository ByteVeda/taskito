package org.byteveda.taskito;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Optional;
import org.byteveda.taskito.serialization.Serializer;
import org.byteveda.taskito.spi.QueueBackend;

/**
 * Default {@link Queue}: maps the typed public API onto a {@link QueueBackend},
 * serializing payloads with the configured {@link Serializer} and decoding
 * native JSON views with a private mapper.
 */
final class DefaultQueue implements Queue {
    private static final ObjectMapper VIEWS = new ObjectMapper();

    private final QueueBackend backend;
    private final Serializer serializer;

    DefaultQueue(QueueBackend backend, Serializer serializer) {
        this.backend = backend;
        this.serializer = serializer;
    }

    @Override
    public <T> String enqueue(Task<T> task, T payload) {
        return enqueue(task, payload, task.options());
    }

    @Override
    public <T> String enqueue(Task<T> task, T payload, EnqueueOptions options) {
        return backend.enqueue(task.name(), serializer.serialize(payload), encode(options));
    }

    @Override
    public String enqueue(String taskName, Object payload) {
        return backend.enqueue(taskName, serializer.serialize(payload), encode(EnqueueOptions.none()));
    }

    @Override
    public Optional<Job> getJob(String jobId) {
        return backend.getJobJson(jobId).map(json -> decode(json, Job.class));
    }

    @Override
    public boolean cancel(String jobId) {
        return backend.cancel(jobId);
    }

    @Override
    public QueueStats stats() {
        return decode(backend.statsJson(), QueueStats.class);
    }

    @Override
    public void close() {
        backend.close();
    }

    private static String encode(EnqueueOptions options) {
        try {
            return VIEWS.writeValueAsString(options);
        } catch (Exception e) {
            throw new TaskitoException("failed to encode options", e);
        }
    }

    private static <R> R decode(String json, Class<R> type) {
        try {
            return VIEWS.readValue(json, type);
        } catch (Exception e) {
            throw new TaskitoException("failed to decode native response", e);
        }
    }
}
