package org.byteveda.taskito.resources;

/**
 * Handed to a resource factory so it can depend on other resources. A
 * {@code WORKER} factory may only {@link #use} other worker resources; a
 * {@code TASK} factory may use either.
 */
public interface ResourceContext {
    /** The scope the factory is building for. */
    ResourceScope scope();

    /** Resolve another resource by name (building it if needed). */
    <T> T use(String name);
}
