package org.byteveda.taskito.test;

import org.byteveda.taskito.Queue;
import org.byteveda.taskito.Taskito;
import org.byteveda.taskito.serialization.Serializer;

/**
 * Opens a {@link Queue} backed by an {@link InMemoryQueueBackend} — no JNI, no
 * disk. Intended for fast unit tests of producers, handlers, retries, and
 * dead-lettering. Workflows are not supported in-memory.
 */
public final class InMemoryTaskito {
    private InMemoryTaskito() {}

    /** A queue over a fresh in-memory backend using the default JSON serializer. */
    public static Queue open() {
        return Taskito.builder().open(new InMemoryQueueBackend());
    }

    /** A queue over a fresh in-memory backend with a custom serializer. */
    public static Queue open(Serializer serializer) {
        return Taskito.builder().serializer(serializer).open(new InMemoryQueueBackend());
    }
}
