package org.byteveda.taskito.annotation;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Marks a method as a task handler. A compile-time annotation processor
 * generates, per enclosing class {@code Foo}, a {@code FooTasks} companion that
 * holds a typed {@link org.byteveda.taskito.task.Task} constant per handler plus
 * a {@code bind(Worker.Builder, Foo)} method — no runtime reflection.
 *
 * <p>The handler method must take exactly one parameter (the payload) and may
 * return a result or {@code void}. The generated task name is {@link #value()},
 * or the method name when {@code value} is empty.
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.SOURCE)
public @interface TaskHandler {
    /** Task name; defaults to the method name when empty. */
    String value() default "";

    /** Target queue; the default queue when empty. */
    String queue() default "";

    /** Max retries; core default when negative. */
    int maxRetries() default -1;

    /** Timeout in milliseconds; core default when negative. */
    long timeoutMs() default -1;

    /** Priority; 0 (default) is left unset. */
    int priority() default 0;
}
