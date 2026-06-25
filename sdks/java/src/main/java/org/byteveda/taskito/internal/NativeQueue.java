package org.byteveda.taskito.internal;

/**
 * JNI surface over the Taskito core.
 *
 * <p>Opaque job payloads cross as {@code byte[]}; options and views cross as
 * JSON strings. Methods throw {@code org.byteveda.taskito.TaskitoException} on
 * native failure. The {@code handle} is an opaque pointer from {@link #open}.
 */
public final class NativeQueue {
    static {
        NativeLoader.load();
    }

    private NativeQueue() {}

    public static native long open(String optionsJson);

    public static native void close(long handle);

    public static native String enqueue(long handle, String taskName, byte[] payload, String optionsJson);

    /** Returns a JSON job view, or {@code null} if absent. */
    public static native String getJob(long handle, String jobId);

    public static native boolean cancel(long handle, String jobId);

    /** Returns a JSON job-count snapshot. */
    public static native String stats(long handle);
}
