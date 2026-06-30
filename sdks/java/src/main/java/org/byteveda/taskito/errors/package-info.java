/**
 * Specific unchecked exceptions for Taskito failure scenarios.
 *
 * <p>All extend {@link org.byteveda.taskito.TaskitoException}, so a caller can
 * catch the base type to handle any SDK error, or a specific subtype
 * ({@link org.byteveda.taskito.errors.SerializationException},
 * {@link org.byteveda.taskito.errors.WorkflowException}, etc.) to react to one
 * category. Native (JNI) errors surface as the base {@code TaskitoException}.
 */
package org.byteveda.taskito.errors;
