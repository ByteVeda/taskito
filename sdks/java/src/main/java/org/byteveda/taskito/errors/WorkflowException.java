package org.byteveda.taskito.errors;

import org.byteveda.taskito.TaskitoException;

/**
 * A workflow could not be driven to completion — e.g. a run was not found, a
 * deferred node has no registered payload, a callable condition was not
 * registered on the worker, or awaiting a run was interrupted.
 */
public class WorkflowException extends TaskitoException {
    public WorkflowException(String message) {
        super(message);
    }

    public WorkflowException(String message, Throwable cause) {
        super(message, cause);
    }
}
