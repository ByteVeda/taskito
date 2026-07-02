package org.byteveda.taskito.errors;

import org.byteveda.taskito.TaskitoException;

/**
 * A gate returned {@code Skip} for an enqueue, so no job was created. Thrown by
 * {@code enqueue}; callers that expect skips should use {@code tryEnqueue},
 * which returns an empty {@code Optional} instead.
 */
public class EnqueueSkippedException extends TaskitoException {
    public EnqueueSkippedException(String message) {
        super(message);
    }
}
