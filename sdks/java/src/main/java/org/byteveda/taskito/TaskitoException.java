package org.byteveda.taskito;

/** Unchecked exception for Taskito SDK and native errors. */
public class TaskitoException extends RuntimeException {
    public TaskitoException(String message) {
        super(message);
    }

    public TaskitoException(String message, Throwable cause) {
        super(message, cause);
    }
}
