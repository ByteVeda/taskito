package org.byteveda.taskito;

import java.util.Optional;

/** A Taskito queue. Obtain one from {@link Taskito#builder()}. */
public interface Queue extends AutoCloseable {
    /** Enqueue a typed payload using the task's default options; returns the job id. */
    <T> String enqueue(Task<T> task, T payload);

    <T> String enqueue(Task<T> task, T payload, EnqueueOptions options);

    /** Enqueue by task name with an arbitrary payload and default options. */
    String enqueue(String taskName, Object payload);

    Optional<Job> getJob(String jobId);

    boolean cancel(String jobId);

    QueueStats stats();

    @Override
    void close();
}
