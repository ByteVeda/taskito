package org.byteveda.taskito;

import java.util.List;
import java.util.Map;
import java.util.Optional;

/** A Taskito queue. Obtain one from {@link Taskito#builder()}. */
public interface Queue extends AutoCloseable {
    // ── Producer ────────────────────────────────────────────────────

    /** Enqueue a typed payload using the task's default options; returns the job id. */
    <T> String enqueue(Task<T> task, T payload);

    <T> String enqueue(Task<T> task, T payload, EnqueueOptions options);

    /** Enqueue by task name with an arbitrary payload and default options. */
    String enqueue(String taskName, Object payload);

    /** Enqueue a batch in one storage call; returns ids in input order. */
    <T> List<String> enqueueMany(Task<T> task, List<T> payloads);

    <T> List<String> enqueueMany(Task<T> task, List<T> payloads, EnqueueOptions options);

    Optional<Job> getJob(String jobId);

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

    Map<String, QueueStats> statsAllQueues();

    List<Job> listJobs(JobFilter filter);

    List<JobError> jobErrors(String jobId);

    /** Per-execution metrics within the last {@code sinceMs}; null task = all. */
    List<TaskMetric> metrics(String taskName, long sinceMs);

    List<WorkerInfo> listWorkers();

    // ── Admin ───────────────────────────────────────────────────────

    List<DeadJob> listDead(long limit, long offset);

    /** Re-enqueue a dead-letter entry; returns the new job id. */
    String retryDead(String deadId);

    boolean deleteDead(String deadId);

    long purgeDead(long olderThanMs);

    long purgeCompleted(long olderThanMs);

    void pauseQueue(String queue);

    void resumeQueue(String queue);

    List<String> listPausedQueues();

    Optional<String> getSetting(String key);

    void setSetting(String key, String value);

    boolean deleteSetting(String key);

    Map<String, String> listSettings();

    // ── Logs ────────────────────────────────────────────────────────

    void writeTaskLog(String jobId, String taskName, String level, String message);

    void writeTaskLog(String jobId, String taskName, String level, String message, String extra);

    List<TaskLog> getTaskLogs(String jobId);

    // ── Worker ──────────────────────────────────────────────────────

    /** Begin building a worker over this queue. */
    Worker.Builder worker();

    @Override
    void close();
}
