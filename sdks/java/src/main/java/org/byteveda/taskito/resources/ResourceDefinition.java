package org.byteveda.taskito.resources;

import java.util.function.Consumer;
import java.util.function.Function;

/**
 * How to build (and optionally dispose) a resource.
 *
 * @param factory builds the resource, possibly using others via the context
 * @param scope the resource's lifetime (defaults to {@link ResourceScope#WORKER})
 * @param dispose optional cleanup run when the scope ends ({@code null} for none)
 * @param pool bounded-pool sizing, required for {@link ResourceScope#POOLED} and
 *     {@code null} for every other scope
 */
public record ResourceDefinition(
        Function<ResourceContext, Object> factory, ResourceScope scope, Consumer<Object> dispose, PoolConfig pool) {

    public ResourceDefinition {
        if (factory == null) {
            throw new IllegalArgumentException("resource factory must not be null");
        }
        if (scope == null) {
            scope = ResourceScope.WORKER;
        }
        if (scope == ResourceScope.POOLED && pool == null) {
            throw new IllegalArgumentException("a pooled resource requires a PoolConfig");
        }
        if (scope != ResourceScope.POOLED && pool != null) {
            throw new IllegalArgumentException("a PoolConfig is only valid for a pooled resource");
        }
    }

    /** A definition for any non-pooled scope. */
    public ResourceDefinition(
            Function<ResourceContext, Object> factory, ResourceScope scope, Consumer<Object> dispose) {
        this(factory, scope, dispose, null);
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
