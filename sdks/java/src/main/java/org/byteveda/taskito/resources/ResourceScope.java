package org.byteveda.taskito.resources;

/** Lifetime of a worker resource. */
public enum ResourceScope {
    /** Built once, lazily, and shared across every task on the worker. */
    WORKER,
    /** Built lazily per task invocation and disposed when the task ends. */
    TASK
}
