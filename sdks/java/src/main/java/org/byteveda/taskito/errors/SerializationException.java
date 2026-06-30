package org.byteveda.taskito.errors;

import org.byteveda.taskito.TaskitoException;

/**
 * A payload, option blob, or native response could not be serialized or
 * deserialized — e.g. an unregistered type, malformed JSON, or a result whose
 * shape does not match the expected class.
 */
public class SerializationException extends TaskitoException {
    public SerializationException(String message) {
        super(message);
    }

    public SerializationException(String message, Throwable cause) {
        super(message, cause);
    }
}
