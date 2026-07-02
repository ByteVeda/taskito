package org.byteveda.taskito.predicates;

/** A feature-flag lookup seam, plugged into {@link Recipes#featureFlag}. */
@FunctionalInterface
public interface BooleanFlag {
    boolean enabled(String flag);
}
