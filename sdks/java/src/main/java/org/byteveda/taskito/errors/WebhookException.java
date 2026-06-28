package org.byteveda.taskito.errors;

import org.byteveda.taskito.TaskitoException;

/**
 * A webhook could not be stored, loaded, signed, or its payload encoded.
 */
public class WebhookException extends TaskitoException {
    public WebhookException(String message) {
        super(message);
    }

    public WebhookException(String message, Throwable cause) {
        super(message, cause);
    }
}
