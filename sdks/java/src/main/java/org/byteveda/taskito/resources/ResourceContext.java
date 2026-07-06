package org.byteveda.taskito.resources;

/**
 * Handed to a resource factory so it can depend on other resources. A factory
 * may only depend on same-or-longer-lived resources: a {@code WORKER} factory
 * may {@link #use} only worker resources, a {@code THREAD} factory may use
 * worker or thread resources, and {@code TASK}/{@code REQUEST} factories may
 * use any scope.
 */
public interface ResourceContext {
    /** The scope the factory is building for. */
    ResourceScope scope();

    /** Resolve another resource by name (building it if needed). */
    <T> T use(String name);
}
