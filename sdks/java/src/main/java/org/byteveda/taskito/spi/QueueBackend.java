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
    String enqueue(String taskName, byte[] payload, String optionsJson);

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

    String jobErrorsJson(String jobId);

    String metricsJson(String taskNameOrNull, long sinceMs);

    String listWorkersJson();

    // ── Admin ───────────────────────────────────────────────────────
    String listDeadJson(long limit, long offset);

    String retryDead(String deadId);

    boolean deleteDead(String deadId);

    long purgeDead(long olderThanMs);

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

    @Override
    void close();
}
