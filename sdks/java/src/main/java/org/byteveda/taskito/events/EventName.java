package org.byteveda.taskito.events;

import org.byteveda.taskito.TaskitoException;

/** Terminal outcome of a job, delivered to worker event listeners. */
public enum EventName {
    SUCCESS,
    RETRY,
    DEAD,
    CANCELLED;

    /** Map a native outcome kind ("success"/"retry"/"dead"/"cancelled"). */
    public static EventName fromKind(String kind) {
        switch (kind) {
            case "success":
                return SUCCESS;
            case "retry":
                return RETRY;
            case "dead":
                return DEAD;
            case "cancelled":
                return CANCELLED;
            default:
                throw new TaskitoException("unknown outcome kind: " + kind);
        }
    }
}
