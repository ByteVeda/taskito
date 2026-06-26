package org.byteveda.taskito.worker;

import org.byteveda.taskito.task.Task;
import org.byteveda.taskito.task.TaskFunction;

/** A task descriptor paired with the function that handles it. */
public final class Handler<T, R> {
    private final Task<T> task;
    private final TaskFunction<T, R> function;

    private Handler(Task<T> task, TaskFunction<T, R> function) {
        this.task = task;
        this.function = function;
    }

    public static <T, R> Handler<T, R> of(Task<T> task, TaskFunction<T, R> function) {
        return new Handler<>(task, function);
    }

    public Task<T> task() {
        return task;
    }

    public TaskFunction<T, R> function() {
        return function;
    }
}
