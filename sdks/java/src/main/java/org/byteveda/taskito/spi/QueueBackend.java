package org.byteveda.taskito.spi;

import java.util.Optional;

/**
 * Low-level queue operations a backend provides, in native-shaped terms (opaque
 * {@code byte[]} payloads, JSON strings for options and views).
 *
 * <p>This is the seam between the public API and its implementation. The default
 * implementation is JNI-backed; alternatives (an FFM backend, or an in-memory
 * fake for tests) can be supplied without touching the public API.
 */
public interface QueueBackend extends AutoCloseable {
    String enqueue(String taskName, byte[] payload, String optionsJson);

    Optional<String> getJobJson(String jobId);

    boolean cancel(String jobId);

    String statsJson();

    @Override
    void close();
}
