package org.byteveda.taskito;

import com.fasterxml.jackson.databind.JavaType;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CopyOnWriteArrayList;
import org.byteveda.taskito.middleware.EnqueueContext;
import org.byteveda.taskito.middleware.Middleware;
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
    private final List<Middleware> middleware = new CopyOnWriteArrayList<>();

    DefaultQueue(QueueBackend backend, Serializer serializer) {
        this.backend = backend;
        this.serializer = serializer;
    }

    @Override
    public Queue use(Middleware middleware) {
        this.middleware.add(middleware);
        return this;
    }

    // ── Producer ────────────────────────────────────────────────────

    @Override
    public <T> String enqueue(Task<T> task, T payload) {
        return enqueue(task, payload, task.options());
    }

    @Override
    public <T> String enqueue(Task<T> task, T payload, EnqueueOptions options) {
        return dispatchEnqueue(task.name(), payload, options);
    }

    @Override
    public String enqueue(String taskName, Object payload) {
        return dispatchEnqueue(taskName, payload, EnqueueOptions.none());
    }

    /** Run onEnqueue middleware, then serialize and submit the (possibly rewritten) job. */
    private String dispatchEnqueue(String taskName, Object payload, EnqueueOptions options) {
        EnqueueContext context = new EnqueueContext(taskName, payload, options);
        for (Middleware m : middleware) {
            m.onEnqueue(context);
        }
        return backend.enqueue(taskName, serializer.serialize(context.payload()), encode(context.options()));
    }

    @Override
    public <T> List<String> enqueueMany(Task<T> task, List<T> payloads) {
        return enqueueMany(task, payloads, task.options());
    }

    @Override
    public <T> List<String> enqueueMany(Task<T> task, List<T> payloads, EnqueueOptions options) {
        byte[][] bytes = new byte[payloads.size()][];
        List<EnqueueOptions> perJob = new ArrayList<>(payloads.size());
        for (int i = 0; i < payloads.size(); i++) {
            bytes[i] = serializer.serialize(payloads.get(i));
            perJob.add(options);
        }
        return Arrays.asList(backend.enqueueMany(task.name(), bytes, encode(perJob)));
    }

    @Override
    public Optional<Job> getJob(String jobId) {
        return backend.getJobJson(jobId).map(json -> decode(json, Job.class));
    }

    @Override
    public Optional<byte[]> getResult(String jobId) {
        return backend.getResult(jobId);
    }

    @Override
    public <R> Optional<R> getResult(String jobId, Class<R> type) {
        return backend.getResult(jobId).map(bytes -> serializer.deserialize(bytes, type));
    }

    @Override
    public boolean cancel(String jobId) {
        return backend.cancel(jobId);
    }

    @Override
    public boolean requestCancel(String jobId) {
        return backend.requestCancel(jobId);
    }

    @Override
    public boolean isCancelRequested(String jobId) {
        return backend.isCancelRequested(jobId);
    }

    @Override
    public void setProgress(String jobId, int progress) {
        backend.setProgress(jobId, progress);
    }

    // ── Inspection ──────────────────────────────────────────────────

    @Override
    public QueueStats stats() {
        return decode(backend.statsJson(), QueueStats.class);
    }

    @Override
    public QueueStats statsByQueue(String queue) {
        return decode(backend.statsByQueueJson(queue), QueueStats.class);
    }

    @Override
    public Map<String, QueueStats> statsAllQueues() {
        return decodeMap(backend.statsAllQueuesJson(), QueueStats.class);
    }

    @Override
    public List<Job> listJobs(JobFilter filter) {
        return decodeList(backend.listJobsJson(encode(filter)), Job.class);
    }

    @Override
    public List<JobError> jobErrors(String jobId) {
        return decodeList(backend.jobErrorsJson(jobId), JobError.class);
    }

    @Override
    public List<TaskMetric> metrics(String taskName, long sinceMs) {
        return decodeList(backend.metricsJson(taskName, sinceMs), TaskMetric.class);
    }

    @Override
    public List<WorkerInfo> listWorkers() {
        return decodeList(backend.listWorkersJson(), WorkerInfo.class);
    }

    // ── Admin ───────────────────────────────────────────────────────

    @Override
    public List<DeadJob> listDead(long limit, long offset) {
        return decodeList(backend.listDeadJson(limit, offset), DeadJob.class);
    }

    @Override
    public String retryDead(String deadId) {
        return backend.retryDead(deadId);
    }

    @Override
    public boolean deleteDead(String deadId) {
        return backend.deleteDead(deadId);
    }

    @Override
    public long purgeDead(long olderThanMs) {
        return backend.purgeDead(olderThanMs);
    }

    @Override
    public long purgeCompleted(long olderThanMs) {
        return backend.purgeCompleted(olderThanMs);
    }

    @Override
    public void pauseQueue(String queue) {
        backend.pauseQueue(queue);
    }

    @Override
    public void resumeQueue(String queue) {
        backend.resumeQueue(queue);
    }

    @Override
    public List<String> listPausedQueues() {
        return decodeList(backend.listPausedQueuesJson(), String.class);
    }

    @Override
    public Optional<String> getSetting(String key) {
        return backend.getSetting(key);
    }

    @Override
    public void setSetting(String key, String value) {
        backend.setSetting(key, value);
    }

    @Override
    public boolean deleteSetting(String key) {
        return backend.deleteSetting(key);
    }

    @Override
    public Map<String, String> listSettings() {
        return decodeMap(backend.listSettingsJson(), String.class);
    }

    // ── Logs ────────────────────────────────────────────────────────

    @Override
    public void writeTaskLog(String jobId, String taskName, String level, String message) {
        backend.writeTaskLog(jobId, taskName, level, message, null);
    }

    @Override
    public void writeTaskLog(String jobId, String taskName, String level, String message, String extra) {
        backend.writeTaskLog(jobId, taskName, level, message, extra);
    }

    @Override
    public List<TaskLog> getTaskLogs(String jobId) {
        return decodeList(backend.getTaskLogsJson(jobId), TaskLog.class);
    }

    @Override
    public Worker.Builder worker() {
        return Worker.builder(backend, serializer, middleware);
    }

    @Override
    public void close() {
        backend.close();
    }

    // ── JSON helpers ────────────────────────────────────────────────

    private static String encode(Object value) {
        try {
            return VIEWS.writeValueAsString(value);
        } catch (Exception e) {
            throw new TaskitoException("failed to encode request", e);
        }
    }

    private static <R> R decode(String json, Class<R> type) {
        try {
            return VIEWS.readValue(json, type);
        } catch (Exception e) {
            throw new TaskitoException("failed to decode native response", e);
        }
    }

    private static <R> List<R> decodeList(String json, Class<R> element) {
        JavaType type = VIEWS.getTypeFactory().constructCollectionType(List.class, element);
        try {
            return VIEWS.readValue(json, type);
        } catch (Exception e) {
            throw new TaskitoException("failed to decode native response", e);
        }
    }

    private static <V> Map<String, V> decodeMap(String json, Class<V> value) {
        JavaType type = VIEWS.getTypeFactory().constructMapType(Map.class, String.class, value);
        try {
            return VIEWS.readValue(json, type);
        } catch (Exception e) {
            throw new TaskitoException("failed to decode native response", e);
        }
    }
}
