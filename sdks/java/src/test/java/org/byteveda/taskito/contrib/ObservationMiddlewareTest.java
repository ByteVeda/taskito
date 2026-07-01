package org.byteveda.taskito.contrib;

import static io.micrometer.observation.tck.TestObservationRegistryAssert.assertThat;

import io.micrometer.observation.tck.TestObservationRegistry;
import org.byteveda.taskito.middleware.TaskContext;
import org.junit.jupiter.api.Test;

class ObservationMiddlewareTest {

    @Test
    void recordsObservationOnSuccess() {
        TestObservationRegistry registry = TestObservationRegistry.create();
        TaskitoObservation middleware = new TaskitoObservation(registry);
        TaskContext context = new TaskContext("job-1", "my.task");

        middleware.before(context);
        middleware.after(context, "ok");

        assertThat(registry)
                .hasObservationWithNameEqualTo("taskito.task")
                .that()
                .hasBeenStarted()
                .hasBeenStopped()
                .hasLowCardinalityKeyValue("taskito.task", "my.task");
    }

    @Test
    void recordsErrorOnFailure() {
        TestObservationRegistry registry = TestObservationRegistry.create();
        TaskitoObservation middleware = new TaskitoObservation(registry);
        TaskContext context = new TaskContext("job-2", "my.task");

        middleware.before(context);
        middleware.onError(context, new IllegalStateException("boom"));

        assertThat(registry)
                .hasObservationWithNameEqualTo("taskito.task")
                .that()
                .hasError();
    }

    @Test
    void filterSkipsUnobservedTasks() {
        TestObservationRegistry registry = TestObservationRegistry.create();
        TaskitoObservation middleware =
                new TaskitoObservation(registry, "taskito.task", task -> task.equals("included"));
        TaskContext context = new TaskContext("job-3", "excluded");

        middleware.before(context);
        middleware.after(context, "ok");

        assertThat(registry).doesNotHaveAnyObservation();
    }
}
