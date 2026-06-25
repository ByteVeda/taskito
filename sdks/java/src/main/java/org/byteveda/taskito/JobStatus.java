package org.byteveda.taskito;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;
import java.util.Locale;

/** Lifecycle state of a job. Wire form is the lowercase name, shared across SDKs. */
public enum JobStatus {
    PENDING,
    RUNNING,
    COMPLETE,
    FAILED,
    DEAD,
    CANCELLED;

    @JsonValue
    public String wire() {
        return name().toLowerCase(Locale.ROOT);
    }

    @JsonCreator
    public static JobStatus fromWire(String wire) {
        return valueOf(wire.toUpperCase(Locale.ROOT));
    }
}
