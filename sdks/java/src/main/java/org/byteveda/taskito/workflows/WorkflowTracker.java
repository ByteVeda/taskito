package org.byteveda.taskito.workflows;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JavaType;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import org.byteveda.taskito.TaskitoException;
import org.byteveda.taskito.events.OutcomeEvent;
import org.byteveda.taskito.serialization.Serializer;
import org.byteveda.taskito.spi.QueueBackend;

/**
 * Advances workflow node and run state from worker outcomes. Attach via
 * {@code Worker.Builder.trackWorkflows()}.
 *
 * <p>On each terminal job outcome it records the node result, then drives the
 * run forward. A static node finalizes the run when all nodes settle. A fan-out
 * producer's result is split into per-item child jobs; a settled fan-out is
 * collected into one fan-in job. An approval <em>gate</em> parks
 * ({@code WAITING_APPROVAL}) until {@code Worker.approveGate}/{@code rejectGate}
 * (or its timeout) resolves it; its successors then run. Deferred non-fan nodes
 * (gates and steps downstream of a gate or fan-in) carry a node row but no job
 * at submit — the tracker creates their job once predecessors settle, taking
 * their payload from a {@link Workflow} registered with
 * {@code trackWorkflows(workflow)}.
 *
 * <p>Each run's DAG (the plan) is loaded lazily from storage and cached until the
 * run reaches a terminal state.
 */
public final class WorkflowTracker {
    private final QueueBackend backend;
    private final Serializer serializer;
    private final ObjectMapper json = new ObjectMapper();
    private final ConcurrentMap<String, RunPlan> plans = new ConcurrentHashMap<>();
    private final ConcurrentMap<String, String> runNames = new ConcurrentHashMap<>();
    private final ScheduledExecutorService gateScheduler =
            Executors.newSingleThreadScheduledExecutor(WorkflowTracker::daemon);

    /** Deferred-node payloads from registered workflows: {@code wfName -> node -> serialized payload}. */
    private final ConcurrentMap<String, Map<String, byte[]>> deferredPayloads = new ConcurrentHashMap<>();
    /** Live gate timeout timers, so a manual resolution can cancel a pending auto-resolution. */
    private final ConcurrentMap<GateKey, ScheduledFuture<?>> gateTimers = new ConcurrentHashMap<>();
    /** Gate keys already resolved, so a timer and a manual call never both fire. */
    private final Set<GateKey> resolvedGates = ConcurrentHashMap.newKeySet();
    /** Deferred nodes already promoted (job created or gate parked), to dedupe concurrent outcomes. */
    private final Set<GateKey> promotedNodes = ConcurrentHashMap.newKeySet();

    public WorkflowTracker(QueueBackend backend, Serializer serializer) {
        this.backend = backend;
        this.serializer = serializer;
    }

    /**
     * Register a workflow so the tracker can supply its deferred nodes' payloads
     * at runtime. Required for any workflow with a gate (or other deferred node)
     * whose downstream steps run a task.
     */
    public void register(Workflow workflow) {
        Map<String, byte[]> byNode = new HashMap<>();
        for (Step step : workflow.steps()) {
            if (step.payload != null) {
                byNode.put(step.name, serializer.serialize(step.payload));
            }
        }
        deferredPayloads.put(workflow.name(), byNode);
    }

    /** Route a successful job outcome. */
    public void onSuccess(OutcomeEvent event) {
        onOutcome(event.jobId, true, null);
    }

    /** Route a dead-lettered (terminally failed) job outcome. */
    public void onDead(OutcomeEvent event) {
        onOutcome(event.jobId, false, event.error);
    }

    private void onOutcome(String jobId, boolean succeeded, String error) {
        NodeRef ref = backend.workflowNodeForJobJson(jobId)
                .map(raw -> decode(raw, NodeRef.class))
                .orElse(null);
        if (ref == null) {
            return; // not a workflow job
        }
        // Record the node outcome; the tracker (not the core) drives cascade + finalize.
        backend.markWorkflowNodeResult(jobId, succeeded, error, true);
        RunPlan plan = plans.computeIfAbsent(ref.runId, this::loadPlan);

        if (ref.nodeName.indexOf('[') >= 0) {
            handleFanOutChild(ref.runId, ref.nodeName, plan);
            return;
        }
        if (succeeded && plan != null) {
            expandFanOutIfAny(ref.runId, ref.nodeName, jobId, plan);
            promoteSuccessors(ref.runId, ref.nodeName, plan);
        } else if (!succeeded) {
            backend.cascadeSkipPending(ref.runId);
        }
        finalizeIfTerminal(ref.runId);
    }

    /** If the just-completed node feeds fan-outs, split its result list into child jobs. */
    private void expandFanOutIfAny(String runId, String node, String jobId, RunPlan plan) {
        List<PlanNode> fanOuts = plan.successorsMatching(node, candidate -> candidate.fanOut != null);
        if (fanOuts.isEmpty()) {
            return;
        }
        List<?> items = serializer.deserialize(fetchResult(jobId), List.class);
        for (PlanNode fanOut : fanOuts) {
            String[] names = new String[items.size()];
            byte[][] payloads = new byte[items.size()][];
            for (int i = 0; i < items.size(); i++) {
                names[i] = fanOut.name + "[" + i + "]";
                payloads[i] = serializer.serialize(items.get(i));
            }
            backend.expandFanOut(
                    runId,
                    fanOut.name,
                    names,
                    payloads,
                    fanOut.taskName,
                    fanOut.queueOrDefault(),
                    fanOut.retries(),
                    fanOut.timeout(),
                    fanOut.priorityOrDefault());
            // An empty producer list yields no child jobs, so no child outcome will
            // ever drive the fan-in — collect it now with an empty result list.
            if (items.isEmpty()) {
                collectFanIns(runId, fanOut.name, List.of(), plan);
            }
        }
    }

    /** When every fan-out child has settled, collect their results into the fan-in job(s). */
    private void handleFanOutChild(String runId, String childName, RunPlan plan) {
        String parent = childName.substring(0, childName.indexOf('['));
        FanOutCompletion done = backend.checkFanOutCompletionJson(runId, parent)
                .map(raw -> decode(raw, FanOutCompletion.class))
                .orElse(null);
        if (done == null) {
            return; // siblings still running, or already handled by a concurrent outcome
        }
        if (!done.succeeded) {
            backend.cascadeSkipPending(runId);
            finalizeIfTerminal(runId);
            return;
        }
        List<Object> results = new ArrayList<>(done.childJobIds.size());
        for (String childJobId : done.childJobIds) {
            results.add(serializer.deserialize(fetchResult(childJobId), Object.class));
        }
        collectFanIns(runId, parent, results, plan);
    }

    /** Create a fan-in job for every fan-in successor of {@code parent}; promote others; finalize if none. */
    private void collectFanIns(String runId, String parent, List<Object> results, RunPlan plan) {
        List<PlanNode> fanIns =
                plan == null ? List.of() : plan.successorsMatching(parent, candidate -> candidate.fanIn != null);
        if (fanIns.isEmpty()) {
            if (plan != null) {
                promoteSuccessors(runId, parent, plan);
            }
            finalizeIfTerminal(runId);
            return;
        }
        byte[] payload = serializer.serialize(results);
        for (PlanNode fanIn : fanIns) {
            backend.createDeferredJob(
                    runId,
                    fanIn.name,
                    payload,
                    fanIn.taskName,
                    fanIn.queueOrDefault(),
                    fanIn.retries(),
                    fanIn.timeout(),
                    fanIn.priorityOrDefault());
        }
    }

    /**
     * Promote every deferred non-fan successor of {@code settledNode} whose
     * predecessors have all settled: park a gate, or create the node's job when
     * all predecessors completed, or skip-and-cascade when one did not.
     */
    private void promoteSuccessors(String runId, String settledNode, RunPlan plan) {
        Map<String, NodeSnapshot> statuses = statusMap(runId);
        for (PlanNode succ : plan.successorsMatching(settledNode, candidate -> !candidate.isFanNode())) {
            promoteDeferred(runId, succ, statuses, plan);
        }
    }

    private void promoteDeferred(String runId, PlanNode node, Map<String, NodeSnapshot> statuses, RunPlan plan) {
        NodeSnapshot snap = statuses.get(node.name);
        if (snap == null || snap.jobId != null || snap.status != NodeStatus.PENDING) {
            return; // static (scheduler-run), already promoted, or already parked
        }
        if (!allTerminal(node.predecessors, statuses)) {
            return; // a predecessor is still in flight
        }
        GateKey promotionKey = new GateKey(runId, node.name);
        if (!promotedNodes.add(promotionKey)) {
            return; // a concurrent outcome already promoted it
        }
        // Roll back the dedupe marker if promotion fails, else the node wedges PENDING.
        try {
            if (!allCompleted(node.predecessors, statuses)) {
                backend.skipWorkflowNode(runId, node.name);
                promoteSuccessors(runId, node.name, plan); // cascade the skip downstream
                return;
            }
            if (node.gate != null) {
                enterGate(runId, node);
                return;
            }
            createDeferredJobFor(runId, node);
        } catch (RuntimeException e) {
            promotedNodes.remove(promotionKey);
            throw e;
        }
    }

    /** Park a gate node for approval, scheduling its timeout auto-resolution if any. */
    private void enterGate(String runId, PlanNode node) {
        backend.setWorkflowNodeWaitingApproval(runId, node.name);
        GateMeta meta = node.gate == null ? null : decode(node.gate, GateMeta.class);
        if (meta != null && meta.timeoutMs != null) {
            GateKey key = new GateKey(runId, node.name);
            gateTimers.put(
                    key,
                    gateScheduler.schedule(
                            () -> onGateTimeout(runId, node.name, meta.onTimeout),
                            meta.timeoutMs,
                            TimeUnit.MILLISECONDS));
        }
    }

    private void onGateTimeout(String runId, String nodeName, String onTimeout) {
        boolean approve = GateAction.fromWire(onTimeout) == GateAction.APPROVE;
        resolveGate(runId, nodeName, approve, approve ? null : "gate timeout");
    }

    /**
     * Resolve a parked gate: complete it (and run its successors) when
     * {@code approved}, else fail it (and skip its successors). Idempotent — the
     * first of a manual call and a timeout wins.
     */
    public void resolveGate(String runId, String nodeName, boolean approved, String error) {
        NodeSnapshot snap = statusMap(runId).get(nodeName);
        if (snap == null || snap.status != NodeStatus.WAITING_APPROVAL) {
            return; // only a parked gate can be resolved (wrong node, not yet parked, or already settled)
        }
        GateKey key = new GateKey(runId, nodeName);
        if (!resolvedGates.add(key)) {
            return; // already resolved by a timer or another caller
        }
        ScheduledFuture<?> timer = gateTimers.remove(key);
        if (timer != null) {
            timer.cancel(false);
        }
        backend.resolveWorkflowGate(runId, nodeName, approved, error);
        RunPlan plan = plans.computeIfAbsent(runId, this::loadPlan);
        if (plan != null) {
            // On reject the gate is Failed, so promoteSuccessors skips its successors.
            promoteSuccessors(runId, nodeName, plan);
        }
        finalizeIfTerminal(runId);
    }

    private void createDeferredJobFor(String runId, PlanNode node) {
        byte[] payload = deferredPayload(runId, node.name);
        if (payload == null) {
            throw new TaskitoException("no payload for deferred workflow node '" + node.name
                    + "'; register the workflow on the worker via trackWorkflows(workflow)");
        }
        backend.createDeferredJob(
                runId,
                node.name,
                payload,
                node.taskName,
                node.queueOrDefault(),
                node.retries(),
                node.timeout(),
                node.priorityOrDefault());
    }

    private byte[] deferredPayload(String runId, String nodeName) {
        String wfName = runNames.computeIfAbsent(
                runId, id -> backend.workflowNameForRun(id).orElse(null));
        if (wfName == null) {
            return null;
        }
        return deferredPayloads.getOrDefault(wfName, Map.of()).get(nodeName);
    }

    private void finalizeIfTerminal(String runId) {
        if (backend.finalizeRunIfTerminal(runId).isPresent()) {
            forget(runId); // run reached a terminal state — drop its cached state
        }
    }

    /** Drop all per-run state once a run is terminal, cancelling any lingering timers. */
    private void forget(String runId) {
        plans.remove(runId);
        runNames.remove(runId);
        gateTimers.keySet().removeIf(key -> {
            if (key.runId.equals(runId)) {
                ScheduledFuture<?> timer = gateTimers.get(key);
                if (timer != null) {
                    timer.cancel(false);
                }
                return true;
            }
            return false;
        });
        resolvedGates.removeIf(key -> key.runId.equals(runId));
        promotedNodes.removeIf(key -> key.runId.equals(runId));
    }

    /** Stop the gate-timeout scheduler. Called when the owning worker closes. */
    public void close() {
        gateScheduler.shutdownNow();
    }

    /**
     * Read a job's serialized result, briefly polling in case the outcome event
     * outran the DB write. A missing result after the window is fatal to the
     * step: returning null here would silently drop a fan-out expansion or fan in
     * a {@code null} element, so we fail loudly instead.
     */
    private byte[] fetchResult(String jobId) {
        for (int attempt = 0; attempt < 50; attempt++) {
            Optional<byte[]> result = backend.getResult(jobId);
            if (result.isPresent()) {
                return result.get();
            }
            try {
                Thread.sleep(100);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new TaskitoException("interrupted awaiting result for workflow job " + jobId, e);
            }
        }
        throw new TaskitoException("no result for workflow job " + jobId + " after 5s");
    }

    private Map<String, NodeSnapshot> statusMap(String runId) {
        WorkflowStatus status = backend.getWorkflowStatusJson(runId)
                .map(raw -> decode(raw, WorkflowStatus.class))
                .orElse(null);
        if (status == null) {
            return Map.of();
        }
        Map<String, NodeSnapshot> byName = new HashMap<>();
        for (NodeSnapshot node : status.nodes) {
            byName.put(node.nodeName, node);
        }
        return byName;
    }

    private static boolean allTerminal(List<String> predecessors, Map<String, NodeSnapshot> statuses) {
        for (String pred : predecessors) {
            NodeSnapshot snap = statuses.get(pred);
            if (snap == null || !isTerminal(snap.status)) {
                return false;
            }
        }
        return true;
    }

    private static boolean allCompleted(List<String> predecessors, Map<String, NodeSnapshot> statuses) {
        for (String pred : predecessors) {
            NodeSnapshot snap = statuses.get(pred);
            if (snap == null || !isCompleted(snap.status)) {
                return false;
            }
        }
        return true;
    }

    private static boolean isTerminal(NodeStatus status) {
        switch (status) {
            case COMPLETED:
            case FAILED:
            case SKIPPED:
            case CACHE_HIT:
            case COMPENSATED:
            case COMPENSATION_FAILED:
                return true;
            default:
                return false;
        }
    }

    private static boolean isCompleted(NodeStatus status) {
        return status == NodeStatus.COMPLETED || status == NodeStatus.CACHE_HIT;
    }

    private RunPlan loadPlan(String runId) {
        return backend.getWorkflowPlanJson(runId)
                .map(raw -> RunPlan.from(decodeList(raw)))
                .orElse(null);
    }

    private <T> T decode(String raw, Class<T> type) {
        try {
            return json.readValue(raw, type);
        } catch (Exception e) {
            throw new TaskitoException("failed to decode workflow data", e);
        }
    }

    private List<PlanNode> decodeList(String raw) {
        JavaType type = json.getTypeFactory().constructCollectionType(List.class, PlanNode.class);
        try {
            return json.readValue(raw, type);
        } catch (Exception e) {
            throw new TaskitoException("failed to decode workflow plan", e);
        }
    }

    private static Thread daemon(Runnable runnable) {
        Thread thread = new Thread(runnable, "taskito-workflow-gates");
        thread.setDaemon(true);
        return thread;
    }

    /** A run + node identity used to key gate timers and dedupe promotion. */
    private static final class GateKey {
        final String runId;
        final String nodeName;

        GateKey(String runId, String nodeName) {
            this.runId = runId;
            this.nodeName = nodeName;
        }

        @Override
        public boolean equals(Object other) {
            if (!(other instanceof GateKey)) {
                return false;
            }
            GateKey that = (GateKey) other;
            return runId.equals(that.runId) && nodeName.equals(that.nodeName);
        }

        @Override
        public int hashCode() {
            return 31 * runId.hashCode() + nodeName.hashCode();
        }
    }

    /** {@code {timeoutMs, onTimeout, message}} parsed from a node's gate metadata. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    private static final class GateMeta {
        final Long timeoutMs;
        final String onTimeout;

        @JsonCreator
        GateMeta(
                @JsonProperty("timeoutMs") Long timeoutMs,
                @JsonProperty("onTimeout") String onTimeout,
                @JsonProperty("message") String message) {
            this.timeoutMs = timeoutMs;
            this.onTimeout = onTimeout;
        }
    }

    /** {@code {runId, nodeName}} from the native node-ref view. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    private static final class NodeRef {
        final String runId;
        final String nodeName;

        @JsonCreator
        NodeRef(@JsonProperty("runId") String runId, @JsonProperty("nodeName") String nodeName) {
            this.runId = runId;
            this.nodeName = nodeName;
        }
    }

    /** {@code {succeeded, childJobIds}} from the native fan-out completion view. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    private static final class FanOutCompletion {
        final boolean succeeded;
        final List<String> childJobIds;

        @JsonCreator
        FanOutCompletion(
                @JsonProperty("succeeded") boolean succeeded, @JsonProperty("childJobIds") List<String> childJobIds) {
            this.succeeded = succeeded;
            this.childJobIds = childJobIds == null ? List.of() : childJobIds;
        }
    }
}
