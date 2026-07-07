package org.byteveda.taskito.errors;

import org.byteveda.taskito.TaskitoException;

/**
 * A job's structured {@code notes} violated the bounded-annotation contract — too many
 * fields, a key or value that is too long, excessive nesting, an unsupported value type,
 * or an encoded size over the limit. The message names the offending key or constraint.
 */
public class NotesValidationException extends TaskitoException {
    public NotesValidationException(String message) {
        super(message);
    }

    public NotesValidationException(String message, Throwable cause) {
        super(message, cause);
    }
}
