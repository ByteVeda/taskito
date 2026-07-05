package org.byteveda.taskito.test;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicLong;
import org.byteveda.taskito.TaskitoException;
import org.byteveda.taskito.spi.QueueBackend;
import org.byteveda.taskito.spi.WorkerBridge;
import org.byteveda.taskito.spi.WorkerControl;

/**
 * A pure-Java, in-memory {@link QueueBackend} for fast unit tests — no JNI, no
 * disk. It runs jobs on a small polling worker (dispatch → complete/fail → retry
 * or dead-letter), and supports inspection, admin, settings, and locks.
 *
 * <p>Not supported: workflows (use a native backend). Periodic registration is
 * recorded but never fires. Behaviour approximates the core for testing handlers,
 * retries, and dead-lettering — it is not the production scheduler.
 */
public final class InMemoryQueueBackend implements QueueBackend {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String DEFAULT_QUEUE = "default";

    private final Map<String, JobRec> jobs = new ConcurrentHashMap<>();
    private final Map<String, String> settings = new ConcurrentHashMap<>();
    private final Map<String, Map<String, Object>> periodics = new ConcurrentHashMap<>();
    private final Map<String, LockRec> locks = new ConcurrentHashMap<>();
    private final List<Map<String, Object>> dead = new CopyOnWriteArrayList<>();
    private final Map<String, List<Map<String, Object>>> logs = new ConcurrentHashMap<>();
    private final java.util.Set<String> paused = ConcurrentHashMap.newKeySet();
    private final List<InMemoryWorker> workers = new CopyOnWriteArrayList<>();
    private final AtomicLong seq = new AtomicLong();

    private static long now() {
        return System.currentTimeMillis();
    }

    // ── Producer ────────────────────────────────────────────────────

    @Override
    public String enqueue(String taskName, byte[] payload, String optionsJson) {
        return enqueueOne(taskName, payload, readNode(optionsJson));
    }

    @Override
    public String[] enqueueMany(String taskName, byte[][] payloads, String optionsJson) {
        JsonNode array = readNode(optionsJson);
        String[] ids = new String[payloads.length];
        for (int i = 0; i < payloads.length; i++) {
            JsonNode opts = array.isArray() && i < array.size() ? array.get(i) : null;
            ids[i] = enqueueOne(taskName, payloads[i], opts);
        }
        return ids;
    }

    // synchronized so the unique-key scan + insert is atomic against claimNext
    // and concurrent enqueues.
    private synchronized String enqueueOne(String taskName, byte[] payload, JsonNode opts) {
        String uniqueKey = text(opts, "uniqueKey");
        if (uniqueKey != null) {
            for (JobRec existing : jobs.values()) {
                if (uniqueKey.equals(existing.uniqueKey)
                        && ("pending".equals(existing.status) || "running".equals(existing.status))) {
                    return existing.id;
                }
            }
        }
        JobRec job = new JobRec();
        job.enqueueSeq = seq.incrementAndGet();
        job.id = "im-" + job.enqueueSeq;
        job.taskName = taskName;
        job.payload = payload;
        job.queue = optText(opts, "queue", DEFAULT_QUEUE);
        job.priority = optInt(opts, "priority", 0);
        job.maxRetries = optInt(opts, "maxRetries", 0);
        job.timeoutMs = optLong(opts, "timeoutMs", 0);
        job.uniqueKey = uniqueKey;
        job.metadata = text(opts, "metadata");
        job.namespace = text(opts, "namespace");
        long createdAt = now();
        job.createdAt = createdAt;
        job.scheduledAt = createdAt + optLong(opts, "delayMs", 0);
        jobs.put(job.id, job);
        return job.id;
    }

    @Override
    public Optional<String> getJobJson(String jobId) {
        JobRec job = jobs.get(jobId);
        return job == null ? Optional.empty() : Optional.of(toJson(jobView(job)));
    }

    @Override
    public Optional<byte[]> getResult(String jobId) {
        JobRec job = jobs.get(jobId);
        return job == null ? Optional.empty() : Optional.ofNullable(job.result);
    }

    // synchronized so a pending→cancelled transition can't race claimNext's
    // pending→running (which is also on the backend monitor).
    @Override
    public synchronized boolean cancel(String jobId) {
        JobRec job = jobs.get(jobId);
        if (job != null && "pending".equals(job.status)) {
            job.status = "cancelled";
            job.completedAt = now();
            return true;
        }
        return false;
    }

    @Override
    public boolean requestCancel(String jobId) {
        JobRec job = jobs.get(jobId);
        if (job != null && "running".equals(job.status)) {
            job.cancelRequested = true;
            return true;
        }
        return false;
    }

    @Override
    public boolean isCancelRequested(String jobId) {
        JobRec job = jobs.get(jobId);
        return job != null && job.cancelRequested;
    }

    @Override
    public void setProgress(String jobId, int progress) {
        JobRec job = jobs.get(jobId);
        if (job != null) {
            job.progress = Math.max(0, Math.min(100, progress));
        }
    }

    // ── Inspection ──────────────────────────────────────────────────

    @Override
    public String statsJson() {
        return toJson(statsFor(null));
    }

    @Override
    public String statsByQueueJson(String queue) {
        return toJson(statsFor(queue));
    }

    @Override
    public String statsAllQueuesJson() {
        Map<String, Object> out = new LinkedHashMap<>();
        jobs.values().stream().map(j -> j.queue).distinct().forEach(q -> out.put(q, statsFor(q)));
        return toJson(out);
    }

    @Override
    public String listJobsJson(String filterJson) {
        JsonNode filter = readNode(filterJson);
        String status = text(filter, "status");
        String queue = text(filter, "queue");
        String task = text(filter, "task");
        int limit = optInt(filter, "limit", Integer.MAX_VALUE);
        int offset = optInt(filter, "offset", 0);
        List<Map<String, Object>> views = new ArrayList<>();
        for (JobRec job : jobs.values()) {
            if (status != null && !status.equals(job.status)) {
                continue;
            }
            if (queue != null && !queue.equals(job.queue)) {
                continue;
            }
            if (task != null && !task.equals(job.taskName)) {
                continue;
            }
            views.add(jobView(job));
        }
        int from = Math.min(offset, views.size());
        int to = limit == Integer.MAX_VALUE ? views.size() : Math.min(from + limit, views.size());
        return toJson(views.subList(from, to));
    }

    @Override
    public String jobErrorsJson(String jobId) {
        return "[]";
    }

    @Override
    public String metricsJson(String taskNameOrNull, long sinceMs) {
        return "[]";
    }

    @Override
    public String listWorkersJson() {
        return "[]";
    }

    // ── Admin ───────────────────────────────────────────────────────

    @Override
    public String listDeadJson(long limit, long offset) {
        int from = (int) Math.min(offset, dead.size());
        int to = (int) Math.min(from + limit, dead.size());
        return toJson(new ArrayList<>(dead.subList(from, to)));
    }

    @Override
    public synchronized String retryDead(String deadId) {
        for (Map<String, Object> entry : dead) {
            if (deadId.equals(entry.get("id"))) {
                JobRec source = jobs.get((String) entry.get("originalJobId"));
                dead.remove(entry);
                JobRec job = new JobRec();
                job.enqueueSeq = seq.incrementAndGet();
                job.id = "im-" + job.enqueueSeq;
                job.taskName = (String) entry.get("taskName");
                job.queue = (String) entry.get("queue");
                job.payload = source == null ? new byte[0] : source.payload;
                job.maxRetries = source == null ? 0 : source.maxRetries;
                // Preserve the rest of the original job's options so a retry
                // behaves like the original, not a stripped-down job.
                if (source != null) {
                    job.priority = source.priority;
                    job.timeoutMs = source.timeoutMs;
                    job.uniqueKey = source.uniqueKey;
                    job.metadata = source.metadata;
                    job.namespace = source.namespace;
                }
                job.createdAt = now();
                job.scheduledAt = job.createdAt;
                jobs.put(job.id, job);
                return job.id;
            }
        }
        throw new TaskitoException("no dead-letter entry: " + deadId);
    }

    @Override
    public boolean deleteDead(String deadId) {
        return dead.removeIf(entry -> deadId.equals(entry.get("id")));
    }

    @Override
    public long purgeDead(long olderThanMs) {
        int before = dead.size();
        dead.removeIf(entry -> ((Number) entry.get("failedAt")).longValue() < olderThanMs);
        return before - dead.size();
    }

    @Override
    public String listDeadByTaskJson(String taskName, long limit, long offset) {
        List<Map<String, Object>> matches = new ArrayList<>();
        for (Map<String, Object> entry : dead) {
            if (taskName.equals(entry.get("taskName"))) {
                matches.add(entry);
            }
        }
        int from = (int) Math.min(offset, matches.size());
        int to = (int) Math.min(from + limit, matches.size());
        return toJson(new ArrayList<>(matches.subList(from, to)));
    }

    @Override
    public long purgeDeadByTask(String taskName) {
        // Count the entries actually removed (not a before/after size diff, which
        // a concurrent onFail append could skew).
        List<Map<String, Object>> matches = new ArrayList<>();
        for (Map<String, Object> entry : dead) {
            if (taskName.equals(entry.get("taskName"))) {
                matches.add(entry);
            }
        }
        dead.removeAll(matches);
        return matches.size();
    }

    @Override
    public long purgeCompleted(long olderThanMs) {
        List<String> remove = new ArrayList<>();
        for (JobRec job : jobs.values()) {
            if ("complete".equals(job.status) && job.completedAt != null && job.completedAt < olderThanMs) {
                remove.add(job.id);
            }
        }
        remove.forEach(jobs::remove);
        return remove.size();
    }

    @Override
    public void pauseQueue(String queue) {
        paused.add(queue);
    }

    @Override
    public void resumeQueue(String queue) {
        paused.remove(queue);
    }

    @Override
    public String listPausedQueuesJson() {
        return toJson(new ArrayList<>(paused));
    }

    @Override
    public Optional<String> getSetting(String key) {
        return Optional.ofNullable(settings.get(key));
    }

    @Override
    public void setSetting(String key, String value) {
        settings.put(key, value);
    }

    @Override
    public boolean deleteSetting(String key) {
        return settings.remove(key) != null;
    }

    @Override
    public String listSettingsJson() {
        return toJson(new LinkedHashMap<>(settings));
    }

    // ── Logs ────────────────────────────────────────────────────────

    @Override
    public void writeTaskLog(String jobId, String taskName, String level, String message, String extraOrNull) {
        Map<String, Object> entry = new LinkedHashMap<>();
        entry.put("id", "log-" + seq.incrementAndGet());
        entry.put("jobId", jobId);
        entry.put("taskName", taskName);
        entry.put("level", level);
        entry.put("message", message);
        entry.put("extra", extraOrNull);
        entry.put("loggedAt", now());
        logs.computeIfAbsent(jobId, k -> new CopyOnWriteArrayList<>()).add(entry);
    }

    @Override
    public String getTaskLogsJson(String jobId) {
        return toJson(new ArrayList<>(logs.getOrDefault(jobId, new ArrayList<>())));
    }

    // ── Locks ───────────────────────────────────────────────────────

    @Override
    public synchronized boolean acquireLock(String name, String ownerId, long ttlMs) {
        LockRec held = locks.get(name);
        if (held != null && held.expiresAt > now() && !held.ownerId.equals(ownerId)) {
            return false;
        }
        locks.put(name, new LockRec(name, ownerId, now(), now() + ttlMs));
        return true;
    }

    @Override
    public synchronized boolean releaseLock(String name, String ownerId) {
        LockRec held = locks.get(name);
        if (held != null && held.ownerId.equals(ownerId)) {
            locks.remove(name);
            return true;
        }
        return false;
    }

    @Override
    public synchronized boolean extendLock(String name, String ownerId, long ttlMs) {
        LockRec held = locks.get(name);
        if (held != null && held.ownerId.equals(ownerId)) {
            held.expiresAt = now() + ttlMs;
            return true;
        }
        return false;
    }

    @Override
    public Optional<String> lockInfoJson(String name) {
        LockRec held = locks.get(name);
        if (held == null || held.expiresAt <= now()) {
            return Optional.empty();
        }
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("lockName", held.name);
        view.put("ownerId", held.ownerId);
        view.put("acquiredAt", held.acquiredAt);
        view.put("expiresAt", held.expiresAt);
        return Optional.of(toJson(view));
    }

    // ── Periodic ────────────────────────────────────────────────────
    // Catalog only — the in-memory backend records periodic tasks but never
    // fires them. list/delete/pause exercise the same management surface as JNI.

    @Override
    public long registerPeriodic(
            String name, String taskName, String cron, byte[] args, String queue, String timezone, boolean enabled) {
        Map<String, Object> rec = new LinkedHashMap<>();
        rec.put("name", name);
        rec.put("taskName", taskName);
        rec.put("cronExpr", cron);
        rec.put("queue", queue);
        rec.put("enabled", enabled);
        rec.put("lastRun", null);
        rec.put("nextRun", now());
        rec.put("timezone", timezone);
        periodics.put(name, rec);
        return now();
    }

    @Override
    public String listPeriodicJson() {
        return toJson(new ArrayList<>(periodics.values()));
    }

    @Override
    public boolean deletePeriodic(String name) {
        return periodics.remove(name) != null;
    }

    @Override
    public boolean setPeriodicEnabled(String name, boolean enabled) {
        Map<String, Object> rec = periodics.get(name);
        if (rec == null) {
            return false;
        }
        rec.put("enabled", enabled);
        return true;
    }

    // ── Worker ──────────────────────────────────────────────────────

    @Override
    public WorkerControl startWorker(WorkerBridge bridge, String optionsJson) {
        InMemoryWorker worker = new InMemoryWorker(bridge, parseQueues(optionsJson));
        workers.add(worker);
        worker.start();
        return worker;
    }

    /** The worker's queue filter from its options JSON; empty = consume every queue. */
    private java.util.Set<String> parseQueues(String optionsJson) {
        java.util.Set<String> queues = new java.util.HashSet<>();
        try {
            JsonNode node = JSON.readTree(optionsJson).get("queues");
            if (node != null && node.isArray()) {
                node.forEach(q -> queues.add(q.asText()));
            }
        } catch (Exception ignored) {
            // Missing or malformed options — fall back to consuming every queue.
        }
        return queues;
    }

    @Override
    public void close() {
        workers.forEach(InMemoryWorker::stop);
        workers.clear();
    }

    // ── Workflows (unsupported in-memory) ───────────────────────────

    private static <T> T unsupported() {
        throw new UnsupportedOperationException(
                "the in-memory backend does not support workflows; use a native backend");
    }

    @Override
    public String submitWorkflow(
            String name,
            int version,
            String stepsJson,
            String[] payloadNames,
            byte[][] payloads,
            String queueDefault,
            String paramsJson,
            String[] deferredNames,
            String parentRunId,
            String parentNodeName) {
        return unsupported();
    }

    @Override
    public String markWorkflowNodeResult(String jobId, boolean succeeded, String error, boolean skipCascade) {
        return unsupported();
    }

    @Override
    public Optional<String> getWorkflowStatusJson(String runId) {
        return unsupported();
    }

    @Override
    public void cancelWorkflowRun(String runId) {
        unsupported();
    }

    @Override
    public Optional<String> getWorkflowPlanJson(String runId) {
        return unsupported();
    }

    @Override
    public Optional<String> workflowNodeForJobJson(String jobId) {
        return unsupported();
    }

    @Override
    public String[] expandFanOut(
            String runId,
            String parentNode,
            String[] childNames,
            byte[][] childPayloads,
            String taskName,
            String queue,
            int maxRetries,
            long timeoutMs,
            int priority) {
        return unsupported();
    }

    @Override
    public Optional<String> checkFanOutCompletionJson(String runId, String parentNode) {
        return unsupported();
    }

    @Override
    public String createDeferredJob(
            String runId,
            String nodeName,
            byte[] payload,
            String taskName,
            String queue,
            int maxRetries,
            long timeoutMs,
            int priority) {
        return unsupported();
    }

    @Override
    public void cascadeSkipPending(String runId) {
        unsupported();
    }

    @Override
    public Optional<String> finalizeRunIfTerminal(String runId) {
        return unsupported();
    }

    // ── Internals ───────────────────────────────────────────────────

    /** Claim a dispatchable pending job (status → running); null if none right now. */
    private synchronized JobRec claimNext(java.util.Set<String> queues) {
        long now = now();
        JobRec best = null;
        for (JobRec job : jobs.values()) {
            if (!"pending".equals(job.status) || job.scheduledAt > now || paused.contains(job.queue)) {
                continue;
            }
            // Honor the worker's queue filter; empty filter = every queue.
            if (!queues.isEmpty() && !queues.contains(job.queue)) {
                continue;
            }
            if (best == null || claimsBefore(job, best)) {
                best = job;
            }
        }
        if (best != null) {
            best.status = "running";
            best.startedAt = now;
        }
        return best;
    }

    /** Production dequeue order: priority DESC, then FIFO (scheduled_at ASC, insertion order on ties). */
    private static boolean claimsBefore(JobRec candidate, JobRec current) {
        if (candidate.priority != current.priority) {
            return candidate.priority > current.priority;
        }
        if (candidate.scheduledAt != current.scheduledAt) {
            return candidate.scheduledAt < current.scheduledAt;
        }
        return candidate.enqueueSeq < current.enqueueSeq;
    }

    private synchronized void onComplete(JobRec job, byte[] result) {
        job.result = result;
        job.status = "complete";
        job.completedAt = now();
    }

    private synchronized void onFail(JobRec job, String error) {
        if (job.retryCount < job.maxRetries) {
            job.retryCount++;
            job.status = "pending";
            job.startedAt = null;
            job.scheduledAt = now();
        } else {
            job.status = "dead";
            job.error = error;
            job.completedAt = now();
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("id", "dead-" + seq.incrementAndGet());
            entry.put("originalJobId", job.id);
            entry.put("queue", job.queue);
            entry.put("taskName", job.taskName);
            entry.put("error", error);
            entry.put("retryCount", job.retryCount);
            entry.put("failedAt", now());
            entry.put("metadata", job.metadata);
            entry.put("dlqRetryCount", 0);
            dead.add(entry);
        }
    }

    private synchronized void onCancel(JobRec job) {
        job.status = "cancelled";
        job.completedAt = now();
    }

    private Map<String, Object> statsFor(String queue) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("pending", count("pending", queue));
        out.put("running", count("running", queue));
        out.put("completed", count("complete", queue));
        out.put("failed", count("failed", queue));
        out.put("dead", count("dead", queue));
        out.put("cancelled", count("cancelled", queue));
        return out;
    }

    private long count(String status, String queue) {
        return jobs.values().stream()
                .filter(j -> status.equals(j.status) && (queue == null || queue.equals(j.queue)))
                .count();
    }

    private static Map<String, Object> jobView(JobRec job) {
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("id", job.id);
        view.put("queue", job.queue);
        view.put("taskName", job.taskName);
        view.put("status", job.status);
        view.put("priority", job.priority);
        view.put("createdAt", job.createdAt);
        view.put("scheduledAt", job.scheduledAt);
        view.put("startedAt", job.startedAt);
        view.put("completedAt", job.completedAt);
        view.put("retryCount", job.retryCount);
        view.put("maxRetries", job.maxRetries);
        view.put("timeoutMs", job.timeoutMs);
        view.put("progress", job.progress);
        view.put("error", job.error);
        view.put("uniqueKey", job.uniqueKey);
        view.put("namespace", job.namespace);
        view.put("metadata", job.metadata);
        return view;
    }

    private static String toJson(Object value) {
        try {
            return JSON.writeValueAsString(value);
        } catch (Exception e) {
            throw new TaskitoException("failed to encode in-memory view", e);
        }
    }

    private static JsonNode readNode(String json) {
        if (json == null || json.isEmpty()) {
            return JSON.nullNode();
        }
        try {
            return JSON.readTree(json);
        } catch (Exception e) {
            throw new TaskitoException("failed to read in-memory options", e);
        }
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node == null ? null : node.get(field);
        return value == null || value.isNull() ? null : value.asText();
    }

    private static String optText(JsonNode node, String field, String fallback) {
        String value = text(node, field);
        return value == null ? fallback : value;
    }

    private static int optInt(JsonNode node, String field, int fallback) {
        JsonNode value = node == null ? null : node.get(field);
        return value == null || value.isNull() ? fallback : value.asInt();
    }

    private static long optLong(JsonNode node, String field, long fallback) {
        JsonNode value = node == null ? null : node.get(field);
        return value == null || value.isNull() ? fallback : value.asLong();
    }

    /** A stored job. */
    private static final class JobRec {
        String id;
        long enqueueSeq;
        String queue = DEFAULT_QUEUE;
        String taskName;
        byte[] payload;
        byte[] result;
        volatile String status = "pending";
        int priority;
        long createdAt;
        long scheduledAt;
        Long startedAt;
        Long completedAt;
        int retryCount;
        int maxRetries;
        long timeoutMs;
        Integer progress;
        String error;
        String uniqueKey;
        String namespace;
        String metadata;
        volatile boolean cancelRequested;
    }

    private static final class LockRec {
        final String name;
        final String ownerId;
        final long acquiredAt;
        long expiresAt;

        LockRec(String name, String ownerId, long acquiredAt, long expiresAt) {
            this.name = name;
            this.ownerId = ownerId;
            this.acquiredAt = acquiredAt;
            this.expiresAt = expiresAt;
        }
    }

    /** Polls for dispatchable jobs and drives outcomes back through the bridge. */
    private final class InMemoryWorker implements WorkerControl {
        private final WorkerBridge bridge;
        private final java.util.Set<String> queues;
        private final Map<Long, String> inFlight = new ConcurrentHashMap<>();
        private volatile boolean running = true;
        private Thread loop;

        InMemoryWorker(WorkerBridge bridge, java.util.Set<String> queues) {
            this.bridge = bridge;
            this.queues = queues;
        }

        void start() {
            loop = new Thread(this::run, "taskito-inmemory-worker");
            loop.setDaemon(true);
            loop.start();
        }

        private void run() {
            while (running) {
                JobRec job;
                while (running && (job = claimNext(queues)) != null) {
                    long token = seq.incrementAndGet();
                    inFlight.put(token, job.id);
                    bridge.onJob(token, job.id, job.taskName, job.payload);
                }
                sleep();
            }
        }

        private void sleep() {
            try {
                Thread.sleep(5);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                running = false;
            }
        }

        @Override
        public void completeJob(long token, byte[] result) {
            String jobId = inFlight.remove(token);
            JobRec job = jobs.get(jobId);
            if (job == null) {
                return;
            }
            onComplete(job, result);
            bridge.onOutcome("success", jobId, job.taskName, null, job.retryCount, false);
        }

        @Override
        public void failJob(long token, String error) {
            String jobId = inFlight.remove(token);
            JobRec job = jobs.get(jobId);
            if (job == null) {
                return;
            }
            boolean willRetry = job.retryCount < job.maxRetries;
            onFail(job, error);
            bridge.onOutcome(willRetry ? "retry" : "dead", jobId, job.taskName, error, job.retryCount, false);
        }

        @Override
        public void cancelJob(long token) {
            String jobId = inFlight.remove(token);
            JobRec job = jobs.get(jobId);
            if (job == null) {
                return;
            }
            onCancel(job);
            bridge.onOutcome("cancelled", jobId, job.taskName, null, job.retryCount, false);
        }

        @Override
        public void stop() {
            running = false;
            if (loop != null) {
                loop.interrupt();
            }
        }

        @Override
        public void close() {
            stop();
        }
    }
}
