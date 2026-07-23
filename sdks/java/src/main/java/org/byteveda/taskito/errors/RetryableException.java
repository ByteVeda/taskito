package org.byteveda.taskito.errors;

import org.byteveda.taskito.TaskitoException;

/**
 * Thrown by a task handler to mark the failure as transient: the job retries on
 * the task's backoff curve until its budget is spent. Overrides the task's
 * {@code retryOn} predicate, so a handler can retry one failure a whitelist
 * would otherwise dead-letter.
 *
 * <p>Retrying is already the default — reach for this only to override a
 * predicate, or to say so explicitly at the throw site.
 */
public class RetryableException extends TaskitoException {
    public RetryableException(String message) {
        super(message);
    }

    public RetryableException(String message, Throwable cause) {
        super(message, cause);
    }
}
