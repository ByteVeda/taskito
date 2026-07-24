package org.byteveda.taskito.events;

/**
 * An approval gate parked, awaiting {@code approveGate}/{@code rejectGate} or
 * its timeout ({@link EventName#WORKFLOW_GATE_REACHED}).
 *
 * @param runId the workflow run's id
 * @param nodeName the parked gate node
 */
public record GateEvent(String runId, String nodeName) implements TaskitoEvent {

    @Override
    public EventName name() {
        return EventName.WORKFLOW_GATE_REACHED;
    }
}
