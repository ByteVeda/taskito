package org.byteveda.taskito;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.function.Consumer;
import java.util.function.Function;
import org.byteveda.taskito.dashboard.DashboardServer;
import org.byteveda.taskito.errors.ConfigurationException;
import org.byteveda.taskito.interception.Interceptor;
import org.byteveda.taskito.internal.JniQueueBackend;
import org.byteveda.taskito.locks.Lock;
import org.byteveda.taskito.locks.LockInfo;
import org.byteveda.taskito.middleware.Middleware;
import org.byteveda.taskito.model.CircuitBreakerState;
import org.byteveda.taskito.model.DeadJob;
import org.byteveda.taskito.model.Job;
import org.byteveda.taskito.model.JobDag;
import org.byteveda.taskito.model.JobError;
import org.byteveda.taskito.model.JobFilter;
import org.byteveda.taskito.model.Page;
import org.byteveda.taskito.model.PeriodicInfo;
import org.byteveda.taskito.model.QueueStats;
import org.byteveda.taskito.model.ReplayEntry;
import org.byteveda.taskito.model.Subscription;
import org.byteveda.taskito.model.TaskLog;
import org.byteveda.taskito.model.TaskMetric;
import org.byteveda.taskito.model.WorkerInfo;
import org.byteveda.taskito.model.WorkflowRunInfo;
import org.byteveda.taskito.predicates.EnqueueGate;
import org.byteveda.taskito.predicates.Predicate;
import org.byteveda.taskito.pubsub.PublishOptions;
import org.byteveda.taskito.pubsub.SubscriptionOptions;
import org.byteveda.taskito.resources.PoolConfig;
import org.byteveda.taskito.resources.ResourceContext;
import org.byteveda.taskito.resources.ResourceScope;
import org.byteveda.taskito.resources.ResourceStat;
import org.byteveda.taskito.scheduling.PeriodicTask;
import org.byteveda.taskito.serialization.CodecSerializer;
import org.byteveda.taskito.serialization.JsonSerializer;
import org.byteveda.taskito.serialization.PayloadCodec;
import org.byteveda.taskito.serialization.Serializer;
import org.byteveda.taskito.spi.QueueBackend;
import org.byteveda.taskito.task.EnqueueOptions;
import org.byteveda.taskito.task.Task;
import org.byteveda.taskito.worker.Worker;
import org.byteveda.taskito.workflows.Workflow;
import org.byteveda.taskito.workflows.WorkflowRun;
import org.byteveda.taskito.workflows.WorkflowStatus;

/**
 * The Taskito client: a handle to a storage backend through which you enqueue,
 * inspect, and administer jobs across every named queue. Obtain one from
 * {@link #builder()}. Operations scoped to a single named queue (pause/resume)
 * live on the {@link Queue} handle returned by {@link #queue(String)}.
 */
public interface Taskito extends AutoCloseable {

    /** Begin configuring a client. */
    static Builder builder() {
        return new Builder();
    }

    /** A handle to one named queue, e.g. {@code taskito.queue("emails").pause()}. */
    Queue queue(String name);

    /** Register cross-cutting middleware (enqueue + worker hooks); returns {@code this}. */
    Taskito use(Middleware middleware);

    // ── Resources (worker-side dependency injection) ─────────────────

    /** Register a worker-scoped resource resolved in handlers via {@code Resources.use(name)}. */
    <T> Taskito resource(String name, Function<ResourceContext, T> factory);

    /** Register a resource with an explicit {@link ResourceScope}. */
    <T> Taskito resource(String name, ResourceScope scope, Function<ResourceContext, T> factory);

    /** Register a resource with a scope and a disposer run when the scope ends. */
    <T> Taskito resource(String name, ResourceScope scope, Function<ResourceContext, T> factory, Consumer<T> dispose);

    /**
     * Register a {@link ResourceScope#POOLED} resource: a bounded pool of
     * instances shared across tasks. Each task checks one instance out for its
     * duration and returns it at task end; {@code pool} bounds capacity and
     * {@code dispose} runs when the pool retires an instance (worker shutdown or
     * {@link PoolConfig#maxLifetime()} expiry).
     */
    <T> Taskito resource(String name, PoolConfig pool, Function<ResourceContext, T> factory, Consumer<T> dispose);

    /** Per-resource counters (created / disposed / active). */
    Map<String, ResourceStat> resourceMetrics();

    /**
     * Gate enqueues of {@code taskName} with {@code predicate}: when it rejects,
     * {@link #enqueue} throws and no job is created. Multiple predicates on one
     * task must all pass. Returns {@code this}.
     */
    Taskito predicate(String taskName, Predicate predicate);

    /**
     * Gate enqueues of {@code taskName} with a richer {@link EnqueueGate} whose
     * {@link org.byteveda.taskito.predicates.EnqueueDecision} can allow, skip,
     * defer, or reject. Gates run in registration order and the first non-allow
     * decision wins. Returns {@code this}.
     */
    Taskito gate(String taskName, EnqueueGate gate);

    /**
     * Register an interceptor that may convert, redirect, or reject each enqueue
     * before it is serialized (see {@link Interceptor}). Returns {@code this}.
     */
    Taskito intercept(Interceptor interceptor);

    /**
     * Set an opt-in admission cap on {@code queue}'s pending backlog. Once the
     * queue holds {@code cap} pending jobs, {@link #enqueue} throws
     * {@link org.byteveda.taskito.errors.QueueFullException}. Enforced
     * producer-side (a non-atomic count-then-insert), so it applies even with no
     * worker running. Returns {@code this}.
     */
    Taskito maxPending(String queue, int cap);

    // ── Producer ────────────────────────────────────────────────────

    /** Enqueue a typed payload using the task's default options; returns the job id. */
    <T> String enqueue(Task<T> task, T payload);

    <T> String enqueue(Task<T> task, T payload, EnqueueOptions options);

    /** Enqueue by task name with an arbitrary payload and default options. */
    String enqueue(String taskName, Object payload);

    /**
     * Like {@link #enqueue(Task, Object)} but gate-aware: returns the job id, or
     * an empty {@code Optional} when a gate skips the enqueue. A gate
     * {@code Reject} still throws.
     */
    <T> Optional<String> tryEnqueue(Task<T> task, T payload);

    <T> Optional<String> tryEnqueue(Task<T> task, T payload, EnqueueOptions options);

    /** Gate-aware {@link #enqueue(String, Object)}; empty when a gate skips the enqueue. */
    Optional<String> tryEnqueue(String taskName, Object payload);

    /** Enqueue a batch in one storage call; returns ids in input order. */
    <T> List<String> enqueueMany(Task<T> task, List<T> payloads);

    <T> List<String> enqueueMany(Task<T> task, List<T> payloads, EnqueueOptions options);

    /** Alias of {@link #enqueueMany(Task, List)} in the guide's vocabulary. */
    <T> List<String> enqueueAll(Task<T> task, List<T> payloads);

    Optional<Job> getJob(String jobId);

    /** Block until the job reaches a terminal state (tests only); throws on timeout. */
    Optional<Job> awaitJob(String jobId, Duration timeout);

    /** The job's raw serialized result, if complete. */
    Optional<byte[]> getResult(String jobId);

    /** The job's result deserialized to {@code type}, if complete. */
    <R> Optional<R> getResult(String jobId, Class<R> type);

    boolean cancel(String jobId);

    boolean requestCancel(String jobId);

    boolean isCancelRequested(String jobId);

    void setProgress(String jobId, int progress);

    // ── Inspection ──────────────────────────────────────────────────

    QueueStats stats();

    QueueStats statsByQueue(String queue);

    /** Count pending jobs on {@code queue} — the primitive behind the {@code maxPending} cap. */
    long countPendingByQueue(String queue);

    Map<String, QueueStats> statsAllQueues();

    List<Job> listJobs(JobFilter filter);

    /**
     * Keyset-paginated {@link #listJobs}, ordered by created time. Pass a page's
     * {@code nextCursor} back as {@code after}; {@code null} starts at the first
     * page, and a {@code null} {@code nextCursor} means the last one.
     *
     * <p>Stays O(page) at any depth, unlike an offset walk. On Redis the status
     * indexes are not seekable, so the keyset is applied in memory — correct, but
     * O(matching rows) rather than O(page).
     *
     * @param filter same predicates as {@link #listJobs}; its {@code offset} is ignored
     * @param after cursor from a previous page, or {@code null} for the first
     */
    Page<Job> listJobsAfter(JobFilter filter, String after);

    /**
     * Keyset-paginated archived-job listing, ordered by completed time. See
     * {@link #listJobsAfter} for the cursor contract.
     *
     * @param limit page size
     * @param after cursor from a previous page, or {@code null} for the first
     */
    Page<Job> listArchivedAfter(long limit, String after);

    List<JobError> jobErrors(String jobId);

    /** Per-execution metrics within the last {@code sinceMs}; null task = all. */
    List<TaskMetric> metrics(String taskName, long sinceMs);

    List<WorkerInfo> listWorkers();

    /** Every configured task's circuit-breaker state. */
    List<CircuitBreakerState> listCircuitBreakers();

    // ── Admin ───────────────────────────────────────────────────────

    List<DeadJob> listDead(long limit, long offset);

    /** Dead-letter entries for a single task, newest first. */
    List<DeadJob> listDeadByTask(String taskName, long limit, long offset);

    /** Delete every dead-letter entry for a task; returns the number removed. */
    long purgeDeadByTask(String taskName);

    /** Re-enqueue a dead-letter entry; returns the new job id. */
    String retryDead(String deadId);

    /** Alias of {@link #retryDead(String)} in the guide's vocabulary. */
    String retry(String deadId);

    /** Re-enqueue a copy of a job (recording it in the replay history); returns the new job id. */
    String replayJob(String jobId);

    /** A job's replay history. */
    List<ReplayEntry> getReplayHistory(String jobId);

    /** The dependency DAG reachable from a job (nodes plus {@code from → to} edges). */
    JobDag jobDag(String jobId);

    boolean deleteDead(String deadId);

    long purgeDead(long olderThanMs);

    long purgeCompleted(long olderThanMs);

    /** The names of every currently paused queue. */
    List<String> listPausedQueues();

    Optional<String> getSetting(String key);

    void setSetting(String key, String value);

    boolean deleteSetting(String key);

    Map<String, String> listSettings();

    // ── Middleware toggles ──────────────────────────────────────────

    /**
     * Stop running {@code middlewareName} for {@code taskName}. Takes effect on
     * the next job — workers read the list per invocation, so no restart is
     * needed. The name is the middleware's fully-qualified class name.
     *
     * @param taskName task to disable it for
     * @param middlewareName fully-qualified class name of the middleware
     */
    void disableMiddleware(String taskName, String middlewareName);

    /**
     * Undo {@link #disableMiddleware}. A no-op when it was not disabled.
     *
     * @param taskName task to re-enable it for
     * @param middlewareName fully-qualified class name of the middleware
     */
    void enableMiddleware(String taskName, String middlewareName);

    /**
     * Middleware names currently disabled for {@code taskName}; empty when none
     * are.
     *
     * @param taskName task to read the list for
     * @return the disabled middleware names
     */
    List<String> listDisabledMiddleware(String taskName);

    // ── Logs ────────────────────────────────────────────────────────

    void writeTaskLog(String jobId, String taskName, String level, String message);

    void writeTaskLog(String jobId, String taskName, String level, String message, String extra);

    List<TaskLog> getTaskLogs(String jobId);

    /** Logs for a job with id after {@code afterId} (UUIDv7-ordered cursor); null = all. */
    List<TaskLog> getTaskLogsAfter(String jobId, String afterId);

    /** Logs across jobs filtered by task/level, at or after {@code sinceMs}, capped at {@code limit}. */
    List<TaskLog> queryTaskLogs(String taskName, String level, long sinceMs, long limit);

    // ── Locks ───────────────────────────────────────────────────────

    /** A distributed lock {@code name} with the given TTL; call {@link Lock#acquire()}. */
    Lock lock(String name, long ttlMs);

    /** A distributed lock {@code name} with a default 30s TTL. */
    Lock lock(String name);

    /** Acquire {@code name}, run {@code body} if obtained, then release; returns whether it ran. */
    boolean withLock(String name, long ttlMs, Runnable body);

    Optional<LockInfo> lockInfo(String name);

    /** Alias of {@link #lockInfo(String)} in the guide's vocabulary. */
    Optional<LockInfo> getLockInfo(String name);

    // ── Periodic ────────────────────────────────────────────────────

    /** Register (or replace) a cron task; returns the next fire time (Unix ms). */
    long registerPeriodic(PeriodicTask task);

    /** Every registered periodic task, enabled or paused. */
    List<PeriodicInfo> listPeriodic();

    /** Unschedule a periodic task; false if none had that name. */
    boolean deletePeriodic(String name);

    /** Stop a periodic task from firing without removing it; false if none had that name. */
    boolean pausePeriodic(String name);

    /** Resume a paused periodic task; false if none had that name. */
    boolean resumePeriodic(String name);

    // ── Pub/Sub ─────────────────────────────────────────────────────

    /**
     * Subscribe {@code task} to {@code topic} as an independent, durable
     * subscriber named after the task. Every {@link #publish} to the topic then
     * enqueues one ordinary job of this task; register a handler for it on the
     * worker as usual. Returns {@code this}.
     */
    <T> Taskito subscribe(String topic, Task<T> task);

    /**
     * As {@link #subscribe(String, Task)} with explicit {@link SubscriptionOptions}.
     * A durable subscription registers immediately; an ephemeral one
     * ({@code durable(false)}) binds to a worker and registers when that worker
     * starts, disappearing once it stops heartbeating.
     */
    <T> Taskito subscribe(String topic, Task<T> task, SubscriptionOptions options);

    /**
     * Publish a message to {@code topic}: one job per active subscription, each
     * carrying the same serialized payload. Returns the created jobs — empty
     * when the topic has no active subscribers (a valid no-op). Each delivery's
     * notes carry {@code topic} and {@code subscription} for filtering.
     */
    List<Job> publish(String topic, Object payload);

    /**
     * As {@link #publish(String, Object)} with {@link PublishOptions}. An
     * {@code idempotencyKey} dedupes per subscriber: republishing the same key
     * yields no new deliveries, and a subscription added later still gets its
     * own copy.
     */
    List<Job> publish(String topic, Object payload, PublishOptions options);

    /** Remove a subscription; false if none matched. */
    boolean unsubscribe(String topic, String name);

    /** Stop deliveries without unregistering; false if none matched. */
    boolean pauseSubscription(String topic, String name);

    /** Resume a paused subscription; false if none matched. */
    boolean resumeSubscription(String topic, String name);

    /** Every registered subscription (active or paused), across all topics. */
    List<Subscription> listSubscriptions();

    /** One topic's active subscriptions. */
    List<Subscription> listSubscriptions(String topic);

    /** Distinct topics that currently have at least one subscription. */
    List<String> listTopics();

    // ── Workflows ───────────────────────────────────────────────────

    /** Submit a workflow DAG; returns a handle to the run. */
    WorkflowRun submitWorkflow(Workflow workflow);

    /**
     * Submit a workflow, supplying per-step payloads keyed by step name. A step's
     * effective payload is {@code payloads.get(name)} when present, else the
     * payload baked into the step. Pairs with the structural
     * {@code Workflow.stepAfter(name, task, deps...)} form.
     */
    WorkflowRun submitWorkflow(Workflow workflow, Map<String, Object> payloads);

    /** Current status of a workflow run, or empty if it no longer exists. */
    Optional<WorkflowStatus> workflowStatus(String runId);

    /** Cancel a workflow run: skip its pending nodes and mark it cancelled. */
    void cancelWorkflow(String runId);

    /** Workflow run summaries, filtered by definition name and/or state, paged. Nulls mean no filter. */
    List<WorkflowRunInfo> listWorkflowRuns(String definitionName, String state, long limit, long offset);

    /** A single workflow run summary, or empty if the run no longer exists. */
    Optional<WorkflowRunInfo> getWorkflowRun(String runId);

    /** Sub-workflow runs spawned by a run. */
    List<WorkflowRunInfo> getWorkflowChildren(String runId);

    /** The serialized DAG JSON backing a run, or empty if the run/definition is gone. */
    Optional<String> getWorkflowDag(String runId);

    // ── Worker ──────────────────────────────────────────────────────

    /** Begin building a worker over this client. */
    Worker.Builder worker();

    // ── Dashboard ───────────────────────────────────────────────────

    /**
     * Start the dashboard HTTP server over this client on {@code port}
     * (0 = ephemeral). Serves openly — no authentication.
     */
    default DashboardServer dashboard(int port) throws IOException {
        return DashboardServer.start(this, port);
    }

    /** As {@link #dashboard(int)}; {@code authEnabled=true} enables the session login flow. */
    default DashboardServer dashboard(int port, boolean authEnabled) throws IOException {
        return DashboardServer.start(this, port, authEnabled);
    }

    /** As {@link #dashboard(int)} but gating {@code /api/*} behind a shared {@code token}. */
    default DashboardServer dashboard(int port, String token) throws IOException {
        return DashboardServer.start(this, port, token);
    }

    @Override
    void close();

    /** Configures and opens a {@link Taskito} client. */
    final class Builder {
        private static final ObjectMapper JSON = new ObjectMapper();
        // Mirrors the Python/Node SDKs: a brokerless SQLite store under .taskito/.
        private static final String DEFAULT_SQLITE_DB = ".taskito/taskito.db";

        private final Map<String, Object> options = new LinkedHashMap<>();
        private Serializer serializer = new JsonSerializer();
        private final List<PayloadCodec> codecs = new ArrayList<>();
        private final Map<String, PayloadCodec> namedCodecs = new LinkedHashMap<>();

        public Builder backend(String backend) {
            // Normalize at the boundary so callers may pass "SQLite"/"REDIS"; the
            // default-DSN branch and the native layer then see a canonical name.
            options.put("backend", backend == null ? null : backend.toLowerCase(Locale.ROOT));
            return this;
        }

        /** Connection string: a file path for SQLite, a URL for Postgres/Redis. */
        public Builder url(String dsn) {
            options.put("dsn", dsn);
            return this;
        }

        /** Shortcut for {@code backend("sqlite")} using the default {@code .taskito/taskito.db}. */
        public Builder sqlite() {
            return backend("sqlite");
        }

        /** Shortcut for {@code backend("sqlite").url(path)}. */
        public Builder sqlite(String path) {
            return backend("sqlite").url(path);
        }

        /** Shortcut for {@code backend("postgres").url(url)}. */
        public Builder postgres(String url) {
            return backend("postgres").url(url);
        }

        /** Shortcut for {@code backend("redis").url(url)}. */
        public Builder redis(String url) {
            return backend("redis").url(url);
        }

        public Builder poolSize(int poolSize) {
            options.put("poolSize", poolSize);
            return this;
        }

        public Builder schema(String schema) {
            options.put("schema", schema);
            return this;
        }

        public Builder prefix(String prefix) {
            options.put("prefix", prefix);
            return this;
        }

        public Builder namespace(String namespace) {
            options.put("namespace", namespace);
            return this;
        }

        public Builder serializer(Serializer serializer) {
            this.serializer = serializer;
            return this;
        }

        /**
         * Apply payload codecs (compress/encrypt/sign) around the serializer, in
         * order on the way out and reversed on the way in. The same chain must be
         * configured on producers and workers. Returns {@code this}.
         */
        public Builder codec(PayloadCodec... codecs) {
            this.codecs.addAll(Arrays.asList(codecs));
            return this;
        }

        /**
         * Register a named codec for per-task selection (e.g. via {@code Task.codecs(...)}
         * or the {@code @Encrypted}/{@code @Compressed} annotations). The same names
         * must be registered on producers and workers. Returns {@code this}.
         */
        public Builder codec(String name, PayloadCodec codec) {
            this.namedCodecs.put(name, codec);
            return this;
        }

        /** The serializer wrapped in the configured codec chain (if any). */
        private Serializer effectiveSerializer() {
            return codecs.isEmpty() ? serializer : new CodecSerializer(serializer, codecs);
        }

        /** Open over an explicit backend, e.g. an in-memory fake in tests. */
        public Taskito open(QueueBackend backend) {
            return new DefaultTaskito(backend, effectiveSerializer(), namedCodecs);
        }

        /** Open the native backend described by the configured options. */
        public Taskito open() {
            String backend = (String) options.getOrDefault("backend", "sqlite");
            if ("sqlite".equals(backend)) {
                String dsn = (String) options.computeIfAbsent("dsn", key -> DEFAULT_SQLITE_DB);
                ensureSqliteParentDir(dsn);
            } else if (!options.containsKey("dsn")) {
                throw new ConfigurationException("url (dsn) is required");
            }
            return new DefaultTaskito(JniQueueBackend.open(encodeOptions()), effectiveSerializer(), namedCodecs);
        }

        /** Create the SQLite file's parent directory (skip in-memory databases). */
        private static void ensureSqliteParentDir(String dsn) {
            if (dsn.equals(":memory:") || dsn.startsWith("file::memory:")) {
                return;
            }
            Path parent = Paths.get(dsn).getParent();
            if (parent == null) {
                return;
            }
            try {
                Files.createDirectories(parent);
            } catch (IOException e) {
                throw new ConfigurationException("failed to create sqlite directory " + parent, e);
            }
        }

        private String encodeOptions() {
            try {
                return JSON.writeValueAsString(options);
            } catch (Exception e) {
                throw new ConfigurationException("failed to encode open options", e);
            }
        }
    }
}
