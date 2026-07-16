package org.byteveda.taskito.spi;

import java.util.Optional;

/**
 * Low-level queue operations a backend provides, in native-shaped terms (opaque
 * {@code byte[]} payloads, JSON strings for options and views).
 *
 * <p>This is the seam between the public API and its implementation. The default
 * implementation is JNI-backed; alternatives (an FFM backend, or an in-memory
 * fake for tests) can be supplied without touching the public API. Methods that
 * return a JSON collection never return {@code null}; nullable scalars are
 * returned as {@link Optional}.
 */
public interface QueueBackend extends AutoCloseable {
    // ── Producer ────────────────────────────────────────────────────

    /** Enqueue one job; {@code optionsJson} is a single {@code EnqueueOptions} object. */
    String enqueue(String taskName, byte[] payload, String optionsJson);

    /**
     * Enqueue a batch. Unlike {@link #enqueue}, {@code optionsJson} is a JSON
     * <em>array</em> of per-job {@code EnqueueOptions}, the same length as
     * {@code payloads}. Returns the job ids in input order.
     */
    String[] enqueueMany(String taskName, byte[][] payloads, String optionsJson);

    Optional<String> getJobJson(String jobId);

    Optional<byte[]> getResult(String jobId);

    boolean cancel(String jobId);

    boolean requestCancel(String jobId);

    boolean isCancelRequested(String jobId);

    void setProgress(String jobId, int progress);

    // ── Inspection ──────────────────────────────────────────────────
    String statsJson();

    String statsByQueueJson(String queue);

    String statsAllQueuesJson();

    String listJobsJson(String filterJson);

    /**
     * A keyset-paginated page of jobs as JSON. Defaults to unsupported: a backend
     * without a seekable ordering cannot honour the cursor contract, and silently
     * returning an unpaginated list would look like the last page.
     */
    default String listJobsAfterJson(String filterJson, String afterOrNull) {
        throw new UnsupportedOperationException("keyset pagination not supported by this backend");
    }

    /** A keyset-paginated page of archived jobs as JSON. See {@link #listJobsAfterJson}. */
    default String listArchivedAfterJson(long limit, String afterOrNull) {
        throw new UnsupportedOperationException("keyset pagination not supported by this backend");
    }

    String jobErrorsJson(String jobId);

    String metricsJson(String taskNameOrNull, long sinceMs);

    String listWorkersJson();

    /** Circuit-breaker states as a JSON array; defaults to none for backends without breakers. */
    default String listCircuitBreakersJson() {
        return "[]";
    }

    // ── Admin ───────────────────────────────────────────────────────
    String listDeadJson(long limit, long offset);

    String retryDead(String deadId);

    /** Re-enqueue a copy of a job and return the new id. */
    default String replayJob(String jobId) {
        throw new UnsupportedOperationException("replay not supported by this backend");
    }

    /** A job's replay history; defaults to none. */
    default String getReplayHistoryJson(String jobId) {
        return "[]";
    }

    /** A job's dependency DAG; defaults to just the empty graph. */
    default String jobDagJson(String jobId) {
        return "{\"nodes\":[],\"edges\":[]}";
    }

    boolean deleteDead(String deadId);

    long purgeDead(long olderThanMs);

    /** A JSON array of dead-letter entries for one task. */
    default String listDeadByTaskJson(String taskName, long limit, long offset) {
        throw new UnsupportedOperationException("per-task dead-letter queries not supported by this backend");
    }

    /** Delete every dead-letter entry for a task; returns the number removed. */
    default long purgeDeadByTask(String taskName) {
        throw new UnsupportedOperationException("per-task dead-letter queries not supported by this backend");
    }

    long purgeCompleted(long olderThanMs);

    void pauseQueue(String queue);

    void resumeQueue(String queue);

    String listPausedQueuesJson();

    Optional<String> getSetting(String key);

    void setSetting(String key, String value);

    boolean deleteSetting(String key);

    String listSettingsJson();

    // ── Logs ────────────────────────────────────────────────────────
    void writeTaskLog(String jobId, String taskName, String level, String message, String extraOrNull);

    String getTaskLogsJson(String jobId);

    /** Logs for a job after a cursor id; defaults to none for backends without cursor support. */
    default String getTaskLogsAfterJson(String jobId, String afterIdOrNull) {
        return "[]";
    }

    /** Logs across jobs filtered by task/level/since; defaults to none. */
    default String queryTaskLogsJson(String taskNameOrNull, String levelOrNull, long sinceMs, long limit) {
        return "[]";
    }

    // ── Locks ───────────────────────────────────────────────────────
    // Optional capability: default to throwing so existing custom backends keep
    // compiling and fail explicitly only when locks are actually used.
    default boolean acquireLock(String name, String ownerId, long ttlMs) {
        throw new UnsupportedOperationException("locks not supported by this backend");
    }

    default boolean releaseLock(String name, String ownerId) {
        throw new UnsupportedOperationException("locks not supported by this backend");
    }

    default boolean extendLock(String name, String ownerId, long ttlMs) {
        throw new UnsupportedOperationException("locks not supported by this backend");
    }

    default Optional<String> lockInfoJson(String name) {
        throw new UnsupportedOperationException("locks not supported by this backend");
    }

    // ── Periodic ────────────────────────────────────────────────────
    default long registerPeriodic(
            String name, String taskName, String cron, byte[] args, String queue, String timezone, boolean enabled) {
        throw new UnsupportedOperationException("periodic tasks not supported by this backend");
    }

    /** A JSON array of every registered periodic task. */
    default String listPeriodicJson() {
        throw new UnsupportedOperationException("periodic tasks not supported by this backend");
    }

    /** Remove a periodic task; false if none had that name. */
    default boolean deletePeriodic(String name) {
        throw new UnsupportedOperationException("periodic tasks not supported by this backend");
    }

    /** Pause (false) or resume (true) a periodic task; false if none had that name. */
    default boolean setPeriodicEnabled(String name, boolean enabled) {
        throw new UnsupportedOperationException("periodic tasks not supported by this backend");
    }

    // ── Pub/Sub ─────────────────────────────────────────────────────
    // Optional capability: default to throwing so existing custom backends keep
    // compiling and fail explicitly only when pub/sub is actually used.
    String PUBSUB_UNSUPPORTED = "pub/sub not supported by this backend";

    /**
     * Insert or update a topic subscription with no per-subscriber delivery
     * settings; deliveries take the queue defaults. This is the base method a
     * backend overrides — the {@code Integer/Integer/Long} overload delegates
     * here so a backend that only implements this form keeps working.
     */
    default void registerSubscription(
            String topic,
            String subscriptionName,
            String taskName,
            String queue,
            boolean durable,
            String ownerWorkerIdOrNull) {
        throw new UnsupportedOperationException(PUBSUB_UNSUPPORTED);
    }

    /**
     * Insert or update a topic subscription (idempotent on topic + name).
     * Re-registering updates routing but preserves a paused state; an ephemeral
     * subscription ({@code durable=false}) requires {@code ownerWorkerIdOrNull}.
     *
     * <p>{@code priority}, {@code maxRetries}, and {@code timeoutMs} are the
     * subscriber task's own delivery settings, persisted on the row so a
     * producer-only process applies them without loading the task; {@code null}
     * means "take the queue default".
     *
     * <p>The default drops the three settings and delegates to the six-argument
     * form, so a backend that predates delivery-setting persistence still
     * registers the subscription (it just takes queue defaults) instead of
     * throwing.
     */
    default void registerSubscription(
            String topic,
            String subscriptionName,
            String taskName,
            String queue,
            boolean durable,
            String ownerWorkerIdOrNull,
            Integer priority,
            Integer maxRetries,
            Long timeoutMs) {
        registerSubscription(topic, subscriptionName, taskName, queue, durable, ownerWorkerIdOrNull);
    }

    /** A JSON array of subscriptions — all of them, or only a topic's active ones. */
    default String listSubscriptionsJson(String topicOrNull) {
        throw new UnsupportedOperationException(PUBSUB_UNSUPPORTED);
    }

    /** Remove a subscription; false if none matched. */
    default boolean unsubscribe(String topic, String subscriptionName) {
        throw new UnsupportedOperationException(PUBSUB_UNSUPPORTED);
    }

    /** Pause (false) or resume (true) a subscription; false if none matched. */
    default boolean setSubscriptionActive(String topic, String subscriptionName, boolean active) {
        throw new UnsupportedOperationException(PUBSUB_UNSUPPORTED);
    }

    /** Drop ephemeral subscriptions whose owning worker is gone; returns the count removed. */
    default long reapEphemeralSubscriptions() {
        throw new UnsupportedOperationException(PUBSUB_UNSUPPORTED);
    }

    /**
     * Fan a payload out to every active subscription of {@code topic}. Returns
     * the created jobs as a JSON array — empty when nothing is subscribed.
     */
    default String publishJson(String topic, byte[] payload, String optionsJson) {
        throw new UnsupportedOperationException(PUBSUB_UNSUPPORTED);
    }

    // ── Workflows ───────────────────────────────────────────────────
    // Optional capability: default to throwing so existing custom backends keep
    // compiling and fail explicitly only when workflows are actually used.
    String WORKFLOWS_UNSUPPORTED = "workflows not supported by this backend";

    default String submitWorkflow(
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
        throw new UnsupportedOperationException(WORKFLOWS_UNSUPPORTED);
    }

    /** Record a node's terminal outcome; returns the run's final state, or {@code null}. */
    default String markWorkflowNodeResult(String jobId, boolean succeeded, String error, boolean skipCascade) {
        throw new UnsupportedOperationException(WORKFLOWS_UNSUPPORTED);
    }

    default Optional<String> getWorkflowStatusJson(String runId) {
        throw new UnsupportedOperationException(WORKFLOWS_UNSUPPORTED);
    }

    default String listWorkflowRunsJson(String definitionNameOrNull, String stateOrNull, long limit, long offset) {
        throw new UnsupportedOperationException(WORKFLOWS_UNSUPPORTED);
    }

    default Optional<String> getWorkflowRunJson(String runId) {
        throw new UnsupportedOperationException(WORKFLOWS_UNSUPPORTED);
    }

    default String getWorkflowChildrenJson(String runId) {
        throw new UnsupportedOperationException(WORKFLOWS_UNSUPPORTED);
    }

    default Optional<String> getWorkflowDagJson(String runId) {
        throw new UnsupportedOperationException(WORKFLOWS_UNSUPPORTED);
    }

    default void cancelWorkflowRun(String runId) {
        throw new UnsupportedOperationException(WORKFLOWS_UNSUPPORTED);
    }

    default Optional<String> getWorkflowPlanJson(String runId) {
        throw new UnsupportedOperationException(WORKFLOWS_UNSUPPORTED);
    }

    default Optional<String> workflowNodeForJobJson(String jobId) {
        throw new UnsupportedOperationException(WORKFLOWS_UNSUPPORTED);
    }

    /** Returns the run's definition name, or empty if the run is absent. */
    default Optional<String> workflowNameForRun(String runId) {
        throw new UnsupportedOperationException(WORKFLOWS_UNSUPPORTED);
    }

    default String[] expandFanOut(
            String runId,
            String parentNode,
            String[] childNames,
            byte[][] childPayloads,
            String taskName,
            String queue,
            int maxRetries,
            long timeoutMs,
            int priority) {
        throw new UnsupportedOperationException(WORKFLOWS_UNSUPPORTED);
    }

    default Optional<String> checkFanOutCompletionJson(String runId, String parentNode) {
        throw new UnsupportedOperationException(WORKFLOWS_UNSUPPORTED);
    }

    default String createDeferredJob(
            String runId,
            String nodeName,
            byte[] payload,
            String taskName,
            String queue,
            int maxRetries,
            long timeoutMs,
            int priority) {
        throw new UnsupportedOperationException(WORKFLOWS_UNSUPPORTED);
    }

    default void cascadeSkipPending(String runId) {
        throw new UnsupportedOperationException(WORKFLOWS_UNSUPPORTED);
    }

    default Optional<String> finalizeRunIfTerminal(String runId) {
        throw new UnsupportedOperationException(WORKFLOWS_UNSUPPORTED);
    }

    /** Park an approval-gate node until it is resolved. */
    default void setWorkflowNodeWaitingApproval(String runId, String nodeName) {
        throw new UnsupportedOperationException(WORKFLOWS_UNSUPPORTED);
    }

    /** Settle a parked gate: completed if approved, else failed with {@code error}. */
    default void resolveWorkflowGate(String runId, String nodeName, boolean approved, String error) {
        throw new UnsupportedOperationException(WORKFLOWS_UNSUPPORTED);
    }

    /** Promote a gate / sub-workflow node to running. */
    default void setWorkflowNodeRunning(String runId, String nodeName) {
        throw new UnsupportedOperationException(WORKFLOWS_UNSUPPORTED);
    }

    /** Mark a node failed. */
    default void failWorkflowNode(String runId, String nodeName, String error) {
        throw new UnsupportedOperationException(WORKFLOWS_UNSUPPORTED);
    }

    /** Mark a node skipped (its condition evaluated false) and cancel any bound job. */
    default void skipWorkflowNode(String runId, String nodeName) {
        throw new UnsupportedOperationException(WORKFLOWS_UNSUPPORTED);
    }

    /** Mark a node as a cache hit (terminal) without running it. */
    default void setWorkflowNodeCacheHit(String runId, String nodeName) {
        throw new UnsupportedOperationException(WORKFLOWS_UNSUPPORTED);
    }

    // ── Saga compensation ─────────────────────────────────────────

    default void setWorkflowRunCompensating(String runId) {
        throw new UnsupportedOperationException(WORKFLOWS_UNSUPPORTED);
    }

    default void setWorkflowRunCompensated(String runId, long completedAt) {
        throw new UnsupportedOperationException(WORKFLOWS_UNSUPPORTED);
    }

    default void setWorkflowRunCompensationFailed(String runId, long completedAt, String error) {
        throw new UnsupportedOperationException(WORKFLOWS_UNSUPPORTED);
    }

    default void setWorkflowRunCompletedWithFailures(String runId, long completedAt) {
        throw new UnsupportedOperationException(WORKFLOWS_UNSUPPORTED);
    }

    default void setWorkflowNodeCompensationJob(
            String runId, String nodeName, String compensationJobId, long startedAt) {
        throw new UnsupportedOperationException(WORKFLOWS_UNSUPPORTED);
    }

    default void setWorkflowNodeCompensated(String runId, String nodeName, long completedAt) {
        throw new UnsupportedOperationException(WORKFLOWS_UNSUPPORTED);
    }

    default void setWorkflowNodeCompensationFailed(String runId, String nodeName, String error, long completedAt) {
        throw new UnsupportedOperationException(WORKFLOWS_UNSUPPORTED);
    }

    // ── Worker ──────────────────────────────────────────────────────
    /** Start a worker that dispatches jobs to {@code bridge}; returns its control. */
    WorkerControl startWorker(WorkerBridge bridge, String optionsJson);

    @Override
    void close();
}
