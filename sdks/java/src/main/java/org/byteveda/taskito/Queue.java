package org.byteveda.taskito;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.byteveda.taskito.locks.Lock;
import org.byteveda.taskito.locks.LockInfo;
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
import org.byteveda.taskito.task.EnqueueOptions;
import org.byteveda.taskito.task.Task;
import org.byteveda.taskito.worker.Worker;
import org.byteveda.taskito.workflows.Workflow;
import org.byteveda.taskito.workflows.WorkflowRun;
import org.byteveda.taskito.workflows.WorkflowStatus;

/** A Taskito queue. Obtain one from {@link Taskito#builder()}. */
public interface Queue extends AutoCloseable {
    /** Register cross-cutting middleware (enqueue + worker hooks); returns {@code this}. */
    Queue use(Middleware middleware);

    // ── Producer ────────────────────────────────────────────────────

    /** Enqueue a typed payload using the task's default options; returns the job id. */
    <T> String enqueue(Task<T> task, T payload);

    <T> String enqueue(Task<T> task, T payload, EnqueueOptions options);

    /** Enqueue by task name with an arbitrary payload and default options. */
    String enqueue(String taskName, Object payload);

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

    /** Alias of {@link #retryDead(String)} in the guide's vocabulary. */
    String retry(String deadId);

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

    // ── Worker ──────────────────────────────────────────────────────

    /** Begin building a worker over this queue. */
    Worker.Builder worker();

    @Override
    void close();
}
