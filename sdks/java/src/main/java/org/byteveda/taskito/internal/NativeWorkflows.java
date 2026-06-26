package org.byteveda.taskito.internal;

/**
 * JNI surface for workflow operations (the native {@code workflows} feature).
 *
 * <p>Opaque payloads cross as {@code byte[]}; step descriptions and views cross
 * as JSON strings. Methods throw {@link org.byteveda.taskito.TaskitoException}
 * on native failure. The {@code handle} is the queue handle from
 * {@link NativeQueue#open}.
 */
public final class NativeWorkflows {
    static {
        NativeLoader.load();
    }

    private NativeWorkflows() {}

    /** Record a run and pre-enqueue a job per static step; returns the run id. */
    public static native String submitWorkflow(
            long handle,
            String name,
            int version,
            String stepsJson,
            String[] payloadNames,
            byte[][] payloads,
            String queueDefault,
            String paramsJson,
            String[] deferredNames);

    /** Record a node's terminal outcome; returns the run's final state, or {@code null}. */
    public static native String markWorkflowNodeResult(
            long handle, String jobId, boolean succeeded, String error, boolean skipCascade);

    /** Returns a JSON run + node snapshot, or {@code null} if the run is absent. */
    public static native String getWorkflowStatus(long handle, String runId);

    public static native void cancelWorkflowRun(long handle, String runId);
}
