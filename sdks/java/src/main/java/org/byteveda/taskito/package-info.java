/**
 * Taskito Java SDK — a typed client over the Rust task-queue core.
 *
 * <p>Open a {@link org.byteveda.taskito.Queue} via
 * {@link org.byteveda.taskito.Taskito#builder()}. Enqueue typed payloads with a
 * {@link org.byteveda.taskito.Task}; payloads serialize through a
 * {@link org.byteveda.taskito.serialization.Serializer}. The implementation
 * talks to the core through the {@link org.byteveda.taskito.spi.QueueBackend}
 * seam, whose default implementation lives in {@code internal}.
 */
package org.byteveda.taskito;
