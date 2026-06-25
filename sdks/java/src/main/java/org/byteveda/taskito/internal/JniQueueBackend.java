package org.byteveda.taskito.internal;

import java.util.Optional;
import org.byteveda.taskito.spi.QueueBackend;
import org.byteveda.taskito.spi.WorkerBridge;
import org.byteveda.taskito.spi.WorkerControl;

/** JNI-backed {@link QueueBackend} over a native queue handle. */
public final class JniQueueBackend implements QueueBackend {
    private final long handle;
    private volatile boolean closed;

    private JniQueueBackend(long handle) {
        this.handle = handle;
    }

    /** Open a native backend from its JSON options. */
    public static JniQueueBackend open(String optionsJson) {
        return new JniQueueBackend(NativeQueue.open(optionsJson));
    }

    @Override
    public String enqueue(String taskName, byte[] payload, String optionsJson) {
        return NativeQueue.enqueue(handle, taskName, payload, optionsJson);
    }

    @Override
    public String[] enqueueMany(String taskName, byte[][] payloads, String optionsJson) {
        return NativeQueue.enqueueMany(handle, taskName, payloads, optionsJson);
    }

    @Override
    public Optional<String> getJobJson(String jobId) {
        return Optional.ofNullable(NativeQueue.getJob(handle, jobId));
    }

    @Override
    public Optional<byte[]> getResult(String jobId) {
        return Optional.ofNullable(NativeQueue.getResult(handle, jobId));
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
