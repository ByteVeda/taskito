package org.byteveda.taskito.internal;

import java.util.Optional;
import org.byteveda.taskito.spi.QueueBackend;
import org.byteveda.taskito.spi.WorkerBridge;
import org.byteveda.taskito.spi.WorkerControl;

/** JNI-backed {@link QueueBackend} over a native queue handle. */
public final class JniQueueBackend implements QueueBackend {
    private final long handle;

    /** Hot byte ops (enqueue/enqueueMany/getResult) route through this; FFM when available, else JNI. */
    private final NativeTransport transport;

    private volatile boolean closed;

    private JniQueueBackend(long handle) {
        this.handle = handle;
        this.transport = NativeTransport.create(handle);
    }

    /** Open a native backend from its JSON options. */
    public static JniQueueBackend open(String optionsJson) {
        return new JniQueueBackend(NativeQueue.open(optionsJson));
    }

    @Override
    public String enqueue(String taskName, byte[] payload, String optionsJson) {
        return transport.enqueue(taskName, payload, optionsJson);
    }

    @Override
    public String[] enqueueMany(String taskName, byte[][] payloads, String optionsJson) {
        return transport.enqueueMany(taskName, payloads, optionsJson);
    }

    @Override
    public Optional<String> getJobJson(String jobId) {
        return Optional.ofNullable(NativeQueue.getJob(handle, jobId));
    }

    @Override
    public Optional<byte[]> getResult(String jobId) {
        return Optional.ofNullable(transport.getResult(jobId));
    }

    @Override
    public boolean cancel(String jobId) {
        return NativeQueue.cancel(handle, jobId);
    }

    @Override
    public boolean requestCancel(String jobId) {
        return NativeQueue.requestCancel(handle, jobId);
    }

    @Override
    public boolean isCancelRequested(String jobId) {
        return NativeQueue.isCancelRequested(handle, jobId);
    }

    @Override
    public void setProgress(String jobId, int progress) {
        NativeQueue.setProgress(handle, jobId, progress);
    }

    @Override
    public String statsJson() {
        return NativeQueue.stats(handle);
    }

    @Override
    public String statsByQueueJson(String queue) {
        return NativeQueue.statsByQueue(handle, queue);
    }

    @Override
    public String statsAllQueuesJson() {
        return NativeQueue.statsAllQueues(handle);
    }

    @Override
    public String listJobsJson(String filterJson) {
        return NativeQueue.listJobs(handle, filterJson);
    }

    @Override
    public String jobErrorsJson(String jobId) {
        return NativeQueue.jobErrors(handle, jobId);
    }

    @Override
    public String metricsJson(String taskNameOrNull, long sinceMs) {
        return NativeQueue.metrics(handle, taskNameOrNull, sinceMs);
    }

    @Override
    public String listWorkersJson() {
        return NativeQueue.listWorkers(handle);
    }

    @Override
    public String listDeadJson(long limit, long offset) {
        return NativeQueue.listDead(handle, limit, offset);
    }

    @Override
    public String retryDead(String deadId) {
        return NativeQueue.retryDead(handle, deadId);
    }

    @Override
    public boolean deleteDead(String deadId) {
        return NativeQueue.deleteDead(handle, deadId);
    }

    @Override
    public long purgeDead(long olderThanMs) {
        return NativeQueue.purgeDead(handle, olderThanMs);
    }

    @Override
    public String listDeadByTaskJson(String taskName, long limit, long offset) {
        return NativeQueue.listDeadByTask(handle, taskName, limit, offset);
    }

    @Override
    public long purgeDeadByTask(String taskName) {
        return NativeQueue.purgeDeadByTask(handle, taskName);
    }

    @Override
    public long purgeCompleted(long olderThanMs) {
        return NativeQueue.purgeCompleted(handle, olderThanMs);
    }

    @Override
    public void pauseQueue(String queue) {
        NativeQueue.pauseQueue(handle, queue);
    }

    @Override
    public void resumeQueue(String queue) {
        NativeQueue.resumeQueue(handle, queue);
    }

    @Override
    public String listPausedQueuesJson() {
        return NativeQueue.listPausedQueues(handle);
    }

    @Override
    public Optional<String> getSetting(String key) {
        return Optional.ofNullable(NativeQueue.getSetting(handle, key));
    }

    @Override
    public void setSetting(String key, String value) {
        NativeQueue.setSetting(handle, key, value);
    }

    @Override
    public boolean deleteSetting(String key) {
        return NativeQueue.deleteSetting(handle, key);
    }

    @Override
    public String listSettingsJson() {
        return NativeQueue.listSettings(handle);
    }

    @Override
    public void writeTaskLog(String jobId, String taskName, String level, String message, String extraOrNull) {
        NativeQueue.writeTaskLog(handle, jobId, taskName, level, message, extraOrNull);
    }

    @Override
    public String getTaskLogsJson(String jobId) {
        return NativeQueue.getTaskLogs(handle, jobId);
    }

    @Override
    public boolean acquireLock(String name, String ownerId, long ttlMs) {
        return NativeQueue.acquireLock(handle, name, ownerId, ttlMs);
    }

    @Override
    public boolean releaseLock(String name, String ownerId) {
        return NativeQueue.releaseLock(handle, name, ownerId);
    }

    @Override
    public boolean extendLock(String name, String ownerId, long ttlMs) {
        return NativeQueue.extendLock(handle, name, ownerId, ttlMs);
    }

    @Override
    public Optional<String> lockInfoJson(String name) {
        return Optional.ofNullable(NativeQueue.getLockInfo(handle, name));
    }

    @Override
    public long registerPeriodic(
            String name, String taskName, String cron, byte[] args, String queue, String timezone, boolean enabled) {
        return NativeQueue.registerPeriodic(handle, name, taskName, cron, args, queue, timezone, enabled);
    }

    @Override
    public String listPeriodicJson() {
        return NativeQueue.listPeriodic(handle);
    }

    @Override
    public boolean deletePeriodic(String name) {
        return NativeQueue.deletePeriodic(handle, name);
    }

    @Override
    public boolean setPeriodicEnabled(String name, boolean enabled) {
        return NativeQueue.setPeriodicEnabled(handle, name, enabled);
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
        return NativeWorkflows.submitWorkflow(
                handle,
                name,
                version,
                stepsJson,
                payloadNames,
                payloads,
                queueDefault,
                paramsJson,
                deferredNames,
                parentRunId,
                parentNodeName);
    }

    @Override
    public String markWorkflowNodeResult(String jobId, boolean succeeded, String error, boolean skipCascade) {
        return NativeWorkflows.markWorkflowNodeResult(handle, jobId, succeeded, error, skipCascade);
    }

    @Override
    public Optional<String> getWorkflowStatusJson(String runId) {
        return Optional.ofNullable(NativeWorkflows.getWorkflowStatus(handle, runId));
    }

    @Override
    public void cancelWorkflowRun(String runId) {
        NativeWorkflows.cancelWorkflowRun(handle, runId);
    }

    @Override
    public Optional<String> getWorkflowPlanJson(String runId) {
        return Optional.ofNullable(NativeWorkflows.getWorkflowPlan(handle, runId));
    }

    @Override
    public Optional<String> workflowNodeForJobJson(String jobId) {
        return Optional.ofNullable(NativeWorkflows.workflowNodeForJob(handle, jobId));
    }

    @Override
    public Optional<String> workflowNameForRun(String runId) {
        return Optional.ofNullable(NativeWorkflows.workflowNameForRun(handle, runId));
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
        return NativeWorkflows.expandFanOut(
                handle, runId, parentNode, childNames, childPayloads, taskName, queue, maxRetries, timeoutMs, priority);
    }

    @Override
    public Optional<String> checkFanOutCompletionJson(String runId, String parentNode) {
        return Optional.ofNullable(NativeWorkflows.checkFanOutCompletion(handle, runId, parentNode));
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
        return NativeWorkflows.createDeferredJob(
                handle, runId, nodeName, payload, taskName, queue, maxRetries, timeoutMs, priority);
    }

    @Override
    public void cascadeSkipPending(String runId) {
        NativeWorkflows.cascadeSkipPending(handle, runId);
    }

    @Override
    public Optional<String> finalizeRunIfTerminal(String runId) {
        return Optional.ofNullable(NativeWorkflows.finalizeRunIfTerminal(handle, runId));
    }

    @Override
    public void setWorkflowNodeWaitingApproval(String runId, String nodeName) {
        NativeWorkflows.setWorkflowNodeWaitingApproval(handle, runId, nodeName);
    }

    @Override
    public void resolveWorkflowGate(String runId, String nodeName, boolean approved, String error) {
        NativeWorkflows.resolveWorkflowGate(handle, runId, nodeName, approved, error);
    }

    @Override
    public void setWorkflowNodeRunning(String runId, String nodeName) {
        NativeWorkflows.setWorkflowNodeRunning(handle, runId, nodeName);
    }

    @Override
    public void failWorkflowNode(String runId, String nodeName, String error) {
        NativeWorkflows.failWorkflowNode(handle, runId, nodeName, error);
    }

    @Override
    public void skipWorkflowNode(String runId, String nodeName) {
        NativeWorkflows.skipWorkflowNode(handle, runId, nodeName);
    }

    @Override
    public void setWorkflowNodeCacheHit(String runId, String nodeName) {
        NativeWorkflows.setWorkflowNodeCacheHit(handle, runId, nodeName);
    }

    @Override
    public void setWorkflowRunCompensating(String runId) {
        NativeWorkflows.setWorkflowRunCompensating(handle, runId);
    }

    @Override
    public void setWorkflowRunCompensated(String runId, long completedAt) {
        NativeWorkflows.setWorkflowRunCompensated(handle, runId, completedAt);
    }

    @Override
    public void setWorkflowRunCompensationFailed(String runId, long completedAt, String error) {
        NativeWorkflows.setWorkflowRunCompensationFailed(handle, runId, completedAt, error);
    }

    @Override
    public void setWorkflowRunCompletedWithFailures(String runId, long completedAt) {
        NativeWorkflows.setWorkflowRunCompletedWithFailures(handle, runId, completedAt);
    }

    @Override
    public void setWorkflowNodeCompensationJob(
            String runId, String nodeName, String compensationJobId, long startedAt) {
        NativeWorkflows.setWorkflowNodeCompensationJob(handle, runId, nodeName, compensationJobId, startedAt);
    }

    @Override
    public void setWorkflowNodeCompensated(String runId, String nodeName, long completedAt) {
        NativeWorkflows.setWorkflowNodeCompensated(handle, runId, nodeName, completedAt);
    }

    @Override
    public void setWorkflowNodeCompensationFailed(String runId, String nodeName, String error, long completedAt) {
        NativeWorkflows.setWorkflowNodeCompensationFailed(handle, runId, nodeName, error, completedAt);
    }

    @Override
    public WorkerControl startWorker(WorkerBridge bridge, String optionsJson) {
        return new JniWorkerControl(NativeQueue.runWorker(handle, bridge, optionsJson));
    }

    /** Idempotent: the native handle is freed exactly once, so a second {@code close()}
     * (e.g. an explicit call plus try-with-resources) can't double-free. */
    @Override
    public synchronized void close() {
        if (!closed) {
            closed = true;
            NativeQueue.close(handle);
        }
    }
}
