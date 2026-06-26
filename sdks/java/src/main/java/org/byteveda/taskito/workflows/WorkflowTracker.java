package org.byteveda.taskito.workflows;

import org.byteveda.taskito.events.OutcomeEvent;
import org.byteveda.taskito.spi.QueueBackend;

/**
 * Advances workflow node and run state from worker outcomes. Attach via
 * {@code Worker.Builder.trackWorkflows()}: on each terminal job outcome it
 * records the node result (a no-op for non-workflow jobs), cascading a
 * fail-fast skip and finalizing the run once every node settles.
 */
public final class WorkflowTracker {
    private final QueueBackend backend;

    public WorkflowTracker(QueueBackend backend) {
        this.backend = backend;
    }

    /** Record a successful job as its workflow node completing. */
    public void onSuccess(OutcomeEvent event) {
        backend.markWorkflowNodeResult(event.jobId, true, null, false);
    }

    /** Record a dead-lettered (terminally failed) job as its workflow node failing. */
    public void onDead(OutcomeEvent event) {
        backend.markWorkflowNodeResult(event.jobId, false, event.error, false);
    }
}
