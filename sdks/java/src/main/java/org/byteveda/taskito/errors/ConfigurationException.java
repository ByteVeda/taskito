package org.byteveda.taskito.errors;

import org.byteveda.taskito.TaskitoException;

/**
 * The SDK was misconfigured — e.g. a required connection URL is missing, or a
 * storage directory could not be created.
 */
public class ConfigurationException extends TaskitoException {
    public ConfigurationException(String message) {
        super(message);
    }

    public ConfigurationException(String message, Throwable cause) {
        super(message, cause);
    }
}
