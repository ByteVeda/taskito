package org.byteveda.taskito.errors;

import org.byteveda.taskito.TaskitoException;

/**
 * An enqueue was rejected by a registered predicate (gate), so no job was
 * created.
 */
public class PredicateRejectedException extends TaskitoException {
    public PredicateRejectedException(String message) {
        super(message);
    }
}
