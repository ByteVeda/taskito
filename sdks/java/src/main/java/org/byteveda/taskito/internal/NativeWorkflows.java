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

    // ── Fan-out / fan-in orchestration (driven by the worker-side tracker) ──

    /** Returns the run's nodes with predecessors + step metadata (JSON), or {@code null}. */
    public static native String getWorkflowPlan(long handle, String runId);

    /** Returns {@code {runId, nodeName}} for a job (JSON), or {@code null} if non-workflow. */
    public static native String workflowNodeForJob(long handle, String jobId);

    /** Expand a fan-out parent into one child job per payload; returns the child job ids. */
    public static native String[] expandFanOut(
            long handle,
            String runId,
            String parentNode,
            String[] childNames,
            byte[][] childPayloads,
            String taskName,
            String queue,
            int maxRetries,
            long timeoutMs,
            int priority);

    /** Returns {@code {succeeded, childJobIds}} once all children settle (JSON), else {@code null}. */
    public static native String checkFanOutCompletion(long handle, String runId, String parentNode);

    /** Enqueue a job for a deferred node (e.g. the fan-in collector); returns the job id. */
    public static native String createDeferredJob(
            long handle,
            String runId,
            String nodeName,
            byte[] payload,
            String taskName,
            String queue,
            int maxRetries,
            long timeoutMs,
            int priority);

    public static native void cascadeSkipPending(long handle, String runId);

    /** Finalize the run if every node is terminal; returns the final state, or {@code null}. */
    public static native String finalizeRunIfTerminal(long handle, String runId);
}
