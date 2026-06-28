package org.byteveda.taskito.test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Duration;
import org.byteveda.taskito.Taskito;
import org.byteveda.taskito.model.Job;
import org.byteveda.taskito.model.JobStatus;
import org.byteveda.taskito.task.Task;
import org.byteveda.taskito.worker.Worker;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

class InMemoryQueueBackendTest {

    @Test
    @Timeout(20)
    void runsJobToCompletion() throws Exception {
        Task<Integer> dbl = Task.of("im.double", Integer.class);
        try (Taskito queue = InMemoryTaskito.open()) { // no JNI, no disk
            String id = queue.enqueue(dbl, 21);
            try (Worker worker = queue.worker().handle(dbl, p -> p * 2).start()) {
                Job job = queue.awaitJob(id, Duration.ofSeconds(10)).orElseThrow();
                assertEquals(JobStatus.COMPLETE, job.status);
                assertEquals(42, queue.getResult(id, Integer.class).orElseThrow());
            }
        }
    }

    @Test
    @Timeout(20)
    void retriesThenDeadLetters() throws Exception {
        Task<Integer> boom = Task.of("im.boom", Integer.class).retries(2);
        try (Taskito queue = InMemoryTaskito.open()) {
            String id = queue.enqueue(boom, 1);
            try (Worker worker = queue.worker()
                    .handle(boom, p -> {
                        throw new IllegalStateException("boom");
                    })
                    .start()) {
                Job job = queue.awaitJob(id, Duration.ofSeconds(10)).orElseThrow();
                assertEquals(JobStatus.DEAD, job.status);
                assertEquals(2, job.retryCount);
                assertTrue(queue.listDead(10, 0).size() >= 1);
            }
        }
    }
}
