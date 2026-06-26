package org.byteveda.taskito;

import com.fasterxml.jackson.databind.JavaType;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CopyOnWriteArrayList;
import org.byteveda.taskito.locks.Lock;
import org.byteveda.taskito.locks.LockInfo;
import org.byteveda.taskito.middleware.EnqueueContext;
import org.byteveda.taskito.middleware.Middleware;
import org.byteveda.taskito.model.DeadJob;
import org.byteveda.taskito.model.Job;
import org.byteveda.taskito.model.JobError;
import org.byteveda.taskito.model.JobFilter;
import org.byteveda.taskito.model.QueueStats;
import org.byteveda.taskito.model.TaskLog;
import org.byteveda.taskito.model.TaskMetric;
import org.byteveda.taskito.model.WorkerInfo;
import org.byteveda.taskito.scheduling.PeriodicTask;
import org.byteveda.taskito.serialization.Serializer;
import org.byteveda.taskito.spi.QueueBackend;
import org.byteveda.taskito.task.EnqueueOptions;
import org.byteveda.taskito.task.Task;
import org.byteveda.taskito.worker.Worker;
import org.byteveda.taskito.workflows.Step;
import org.byteveda.taskito.workflows.Workflow;
import org.byteveda.taskito.workflows.WorkflowRun;
import org.byteveda.taskito.workflows.WorkflowStatus;

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
    public Lock lock(String name, long ttlMs) {
        return new Lock(backend, name, ttlMs);
    }

    @Override
    public boolean withLock(String name, long ttlMs, Runnable body) {
        try (Lock lock = new Lock(backend, name, ttlMs)) {
            if (!lock.acquire()) {
                return false;
            }
            body.run();
            return true;
        }
    }

    @Override
    public Optional<LockInfo> lockInfo(String name) {
        return backend.lockInfoJson(name).map(json -> decode(json, LockInfo.class));
    }

    @Override
    public long registerPeriodic(PeriodicTask task) {
        byte[] payload = task.payload == null ? null : serializer.serialize(task.payload);
        return backend.registerPeriodic(
                task.name, task.taskName, task.cron, payload, task.queue, task.timezone, task.enabled);
    }

    // ── Workflows ───────────────────────────────────────────────────

    @Override
    public WorkflowRun submitWorkflow(Workflow workflow) {
        List<Step> steps = workflow.steps();
        List<Map<String, Object>> specs = new ArrayList<>(steps.size());
        String[] names = new String[steps.size()];
        byte[][] payloads = new byte[steps.size()][];
        for (int i = 0; i < steps.size(); i++) {
            Step step = steps.get(i);
            specs.add(stepSpec(step));
            names[i] = step.name;
            payloads[i] = serializer.serialize(step.payload);
        }
        String runId = backend.submitWorkflow(
                workflow.name(), workflow.version(), encode(specs), names, payloads, null, null, new String[0]);
        return new WorkflowRun(backend, VIEWS, runId, workflow.name());
    }

    @Override
    public Optional<WorkflowStatus> workflowStatus(String runId) {
        return backend.getWorkflowStatusJson(runId).map(json -> decode(json, WorkflowStatus.class));
    }

    @Override
    public void cancelWorkflow(String runId) {
        backend.cancelWorkflowRun(runId);
    }

    /** Encode a step's structure + per-step overrides for the native submit call. */
    private static Map<String, Object> stepSpec(Step step) {
        Map<String, Object> spec = new LinkedHashMap<>();
        spec.put("name", step.name);
        spec.put("taskName", step.taskName);
        spec.put("after", step.after);
        if (step.queue != null) {
            spec.put("queue", step.queue);
        }
        if (step.maxRetries != null) {
            spec.put("maxRetries", step.maxRetries);
        }
        if (step.timeoutMs != null) {
            spec.put("timeoutMs", step.timeoutMs);
        }
        if (step.priority != null) {
            spec.put("priority", step.priority);
        }
        return spec;
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
