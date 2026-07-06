package org.byteveda.taskito.resources;

/** Lifetime of a worker resource. */
public enum ResourceScope {
    /** Built once, lazily, and shared across every task on the worker. */
    WORKER,
    /**
     * Built lazily once per worker thread and shared by every task that runs on
     * that thread; disposed when the worker shuts down. If the pool retires a
     * thread early (cached pools, autoscale), its instance is retained until
     * worker teardown — bounded by the number of threads the pool ever created.
     */
    THREAD,
    /** Built lazily per task invocation and disposed when the task ends. */
    TASK,
    /**
     * Built fresh on every {@code use()} and disposed when the task ends —
     * never cached, so N uses inside one task yield N instances.
     */
    REQUEST
}
