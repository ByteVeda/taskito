package org.byteveda.taskito.internal;

/**
 * JNI surface over the Taskito core.
 *
 * <p>Opaque job payloads cross as {@code byte[]}; options, filters, and views
 * cross as JSON strings. Methods throw {@link org.byteveda.taskito.TaskitoException}
 * on native failure. The {@code handle} is an opaque pointer from {@link #open}.
 */
public final class NativeQueue {
    static {
        NativeLoader.load();
    }

    private NativeQueue() {}

    // ── Lifecycle ───────────────────────────────────────────────────
    public static native long open(String optionsJson);

    public static native void close(long handle);

    // ── Producer ────────────────────────────────────────────────────
    public static native String enqueue(long handle, String taskName, byte[] payload, String optionsJson);

    public static native String[] enqueueMany(long handle, String taskName, byte[][] payloads, String optionsJson);

    /** Returns a JSON job view, or {@code null} if absent. */
    public static native String getJob(long handle, String jobId);

    /** Returns the job's serialized result, or {@code null} if absent/incomplete. */
    public static native byte[] getResult(long handle, String jobId);

    public static native boolean cancel(long handle, String jobId);

    public static native boolean requestCancel(long handle, String jobId);

    public static native boolean isCancelRequested(long handle, String jobId);

    public static native void setProgress(long handle, String jobId, int progress);

    // ── Inspection ──────────────────────────────────────────────────
    public static native String stats(long handle);

    public static native String statsByQueue(long handle, String queue);

    public static native String statsAllQueues(long handle);

    public static native String listJobs(long handle, String filterJson);

    public static native String jobErrors(long handle, String jobId);

    public static native String metrics(long handle, String taskNameOrNull, long sinceMs);

    public static native String listWorkers(long handle);

    // ── Admin ───────────────────────────────────────────────────────
    public static native String listDead(long handle, long limit, long offset);

    public static native String retryDead(long handle, String deadId);

    public static native boolean deleteDead(long handle, String deadId);

    public static native long purgeDead(long handle, long olderThanMs);

    public static native long purgeCompleted(long handle, long olderThanMs);

    public static native void pauseQueue(long handle, String queue);

    public static native void resumeQueue(long handle, String queue);

    public static native String listPausedQueues(long handle);

    /** Returns the value, or {@code null} if unset. */
    public static native String getSetting(long handle, String key);

    public static native void setSetting(long handle, String key, String value);

    public static native boolean deleteSetting(long handle, String key);

    public static native String listSettings(long handle);

    // ── Logs ────────────────────────────────────────────────────────
    public static native void writeTaskLog(
            long handle, String jobId, String taskName, String level, String message, String extraOrNull);

    public static native String getTaskLogs(long handle, String jobId);

    // ── Worker ──────────────────────────────────────────────────────
    /** Start a worker; returns its handle. {@code bridge} is a {@code WorkerBridge}. */
    public static native long runWorker(long handle, Object bridge, String optionsJson);
}
