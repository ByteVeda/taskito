package org.byteveda.taskito.errors;

import org.byteveda.taskito.TaskitoException;

/**
 * A distributed lock operation failed or was interrupted while waiting to
 * acquire the lock.
 */
public class LockException extends TaskitoException {
    public LockException(String message) {
        super(message);
    }

    public LockException(String message, Throwable cause) {
        super(message, cause);
    }
}
