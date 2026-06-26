package org.byteveda.taskito.workflows;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JavaType;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import org.byteveda.taskito.TaskitoException;
import org.byteveda.taskito.events.OutcomeEvent;
import org.byteveda.taskito.serialization.Serializer;
import org.byteveda.taskito.spi.QueueBackend;

/**
 * Advances workflow node and run state from worker outcomes. Attach via
 * {@code Worker.Builder.trackWorkflows()}.
 *
 * <p>On each terminal job outcome it records the node result, then drives the
 * run forward: a static node simply finalizes the run when all nodes settle; a
 * fan-out producer's result is split into per-item child jobs; a settled fan-out
 * is collected into one fan-in job. Each run's DAG is loaded lazily from storage
 * (the plan) and cached until the run reaches a terminal state.
 */
public final class WorkflowTracker {
    private final QueueBackend backend;
    private final Serializer serializer;
    private final ObjectMapper json = new ObjectMapper();
    private final ConcurrentMap<String, RunPlan> plans = new ConcurrentHashMap<>();

    public WorkflowTracker(QueueBackend backend, Serializer serializer) {
        this.backend = backend;
        this.serializer = serializer;
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

    /** Create a fan-in job for every fan-in successor of {@code parent}; finalize if none. */
    private void collectFanIns(String runId, String parent, List<Object> results, RunPlan plan) {
        List<PlanNode> fanIns =
                plan == null ? List.of() : plan.successorsMatching(parent, candidate -> candidate.fanIn != null);
        if (fanIns.isEmpty()) {
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

    private void finalizeIfTerminal(String runId) {
        if (backend.finalizeRunIfTerminal(runId).isPresent()) {
            plans.remove(runId); // run reached a terminal state — drop its cached plan
        }
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
