package org.byteveda.taskito.errors;

import org.byteveda.taskito.TaskitoException;

/** An interceptor rejected an enqueue, so no job was created. */
public class InterceptionException extends TaskitoException {
    public InterceptionException(String message) {
        super(message);
    }
}
