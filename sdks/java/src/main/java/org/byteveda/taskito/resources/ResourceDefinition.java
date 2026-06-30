package org.byteveda.taskito.resources;

import java.util.function.Consumer;
import java.util.function.Function;

/**
 * How to build (and optionally dispose) a resource.
 *
 * @param factory builds the resource, possibly using others via the context
 * @param scope the resource's lifetime (defaults to {@link ResourceScope#WORKER})
 * @param dispose optional cleanup run when the scope ends ({@code null} for none)
 */
public record ResourceDefinition(
        Function<ResourceContext, Object> factory, ResourceScope scope, Consumer<Object> dispose) {

    public ResourceDefinition {
        if (factory == null) {
            throw new IllegalArgumentException("resource factory must not be null");
        }
        if (scope == null) {
            scope = ResourceScope.WORKER;
        }
    }

    /** A worker-scoped resource with no disposer. */
    public static ResourceDefinition worker(Function<ResourceContext, Object> factory) {
        return new ResourceDefinition(factory, ResourceScope.WORKER, null);
    }

    /** A task-scoped resource with no disposer. */
    public static ResourceDefinition task(Function<ResourceContext, Object> factory) {
        return new ResourceDefinition(factory, ResourceScope.TASK, null);
    }
}
