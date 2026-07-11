package org.byteveda.taskito.test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import org.byteveda.taskito.Taskito;
import org.byteveda.taskito.model.Job;
import org.byteveda.taskito.model.JobStatus;
import org.byteveda.taskito.model.Subscription;
import org.byteveda.taskito.pubsub.PublishOptions;
import org.byteveda.taskito.pubsub.SubscriptionOptions;
import org.byteveda.taskito.task.Task;
import org.byteveda.taskito.worker.Worker;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

class InMemoryPubSubTest {

    private static final Task<String> EMAIL = Task.of("im.pubsub.email", String.class);
    private static final Task<String> AUDIT = Task.of("im.pubsub.audit", String.class);

    @Test
    @Timeout(20)
    void publishFansOutAndDeliversToEachSubscriberHandler() throws Exception {
        try (Taskito queue = InMemoryTaskito.open()) {
            queue.subscribe("orders", EMAIL);
            queue.subscribe("orders", AUDIT);
            try (Worker worker = queue.worker()
                    .handle(EMAIL, payload -> "email:" + payload)
                    .handle(AUDIT, payload -> "audit:" + payload)
                    .start()) {
                List<Job> deliveries = queue.publish("orders", "o-1");
                assertEquals(2, deliveries.size());
                for (Job delivery : deliveries) {
                    Job done =
                            queue.awaitJob(delivery.id, Duration.ofSeconds(10)).orElseThrow();
                    assertEquals(JobStatus.COMPLETE, done.status);
                    assertEquals(
                            done.taskName.equals(EMAIL.name()) ? "email:o-1" : "audit:o-1",
                            queue.getResult(done.id, String.class).orElseThrow());
                }
            }
        }
    }

    @Test
    void publishWithoutSubscribersIsANoOp() {
        try (Taskito queue = InMemoryTaskito.open()) {
            assertTrue(queue.publish("orders", "o-1").isEmpty());
        }
    }

    @Test
    void redeclareUpsertsOnTopicAndName() {
        try (Taskito queue = InMemoryTaskito.open()) {
            queue.subscribe(
                    "orders", EMAIL, SubscriptionOptions.builder().name("sink").build());
            queue.subscribe(
                    "orders", AUDIT, SubscriptionOptions.builder().name("sink").build());
            List<Subscription> subs = queue.listSubscriptions("orders");
            assertEquals(1, subs.size());
            assertEquals(AUDIT.name(), subs.get(0).taskName);
        }
    }

    @Test
    void unsubscribeReportsWhetherAnythingWasRemoved() {
        try (Taskito queue = InMemoryTaskito.open()) {
            queue.subscribe("orders", EMAIL);
            assertTrue(queue.unsubscribe("orders", EMAIL.name()));
            assertFalse(queue.unsubscribe("orders", EMAIL.name()));
        }
    }

    @Test
    void pauseBlocksDeliveriesAndResumeRestoresThem() {
        try (Taskito queue = InMemoryTaskito.open()) {
            queue.subscribe("orders", EMAIL);
            queue.subscribe("orders", AUDIT);

            assertTrue(queue.pauseSubscription("orders", AUDIT.name()));
            List<Job> paused = queue.publish("orders", "o-1");
            assertEquals(1, paused.size());
            assertEquals(EMAIL.name(), paused.get(0).taskName);
            assertEquals(1, queue.listSubscriptions("orders").size());
            assertEquals(2, queue.listSubscriptions().size());

            assertTrue(queue.resumeSubscription("orders", AUDIT.name()));
            assertEquals(2, queue.publish("orders", "o-2").size());
        }
    }

    @Test
    void idempotencyKeyDedupesPerSubscriberButNotAcrossThem() {
        try (Taskito queue = InMemoryTaskito.open()) {
            queue.subscribe("orders", EMAIL);
            queue.subscribe("orders", AUDIT);
            PublishOptions keyed =
                    PublishOptions.builder().idempotencyKey("evt-1").build();

            List<Job> first = queue.publish("orders", "o-1", keyed);
            List<Job> second = queue.publish("orders", "o-1", keyed);
            assertEquals(2, first.size());
            assertEquals(2, second.size());
            assertEquals(first.get(0).id, second.get(0).id);
            assertEquals(first.get(1).id, second.get(1).id);
            assertEquals(2, queue.stats().pending);
        }
    }

    @Test
    void deliveriesCarryStampedNotesAndTaskDefaults() {
        try (Taskito queue = InMemoryTaskito.open()) {
            queue.subscribe("orders", EMAIL.priority(7).maxRetries(2));
            List<Job> deliveries = queue.publish(
                    "orders",
                    "o-1",
                    PublishOptions.builder().notes(Map.of("tenant", "acme")).build());

            assertEquals(1, deliveries.size());
            Job delivery = deliveries.get(0);
            assertEquals(7, delivery.priority);
            assertEquals(2, delivery.maxRetries);
            Map<String, Object> notes = delivery.notesMap().orElseThrow();
            assertEquals("orders", notes.get("topic"));
            assertEquals(EMAIL.name(), notes.get("subscription"));
            assertEquals("acme", notes.get("tenant"));

            // An explicit publish-level override beats the subscriber's defaults.
            List<Job> overridden = queue.publish(
                    "orders", "o-2", PublishOptions.builder().priority(9).build());
            assertEquals(9, overridden.get(0).priority);
        }
    }

    @Test
    @Timeout(20)
    void ephemeralSubscriptionBindsToAWorkerAndIsReapedWhenItStops() {
        try (Taskito queue = InMemoryTaskito.open()) {
            queue.subscribe("orders", EMAIL);
            queue.subscribe(
                    "orders",
                    AUDIT,
                    SubscriptionOptions.builder().durable(false).build());

            // The ephemeral subscriber has no owning worker yet: durable only.
            assertEquals(1, queue.publish("orders", "o-1").size());

            try (Worker worker = queue.worker()
                    .handle(EMAIL, payload -> payload)
                    .handle(AUDIT, payload -> payload)
                    .start()) {
                assertEquals(2, queue.publish("orders", "o-2").size());
            }

            // Worker stopped: its ephemeral subscription is reaped, durable survives.
            List<Job> after = queue.publish("orders", "o-3");
            assertEquals(1, after.size());
            assertEquals(EMAIL.name(), after.get(0).taskName);
        }
    }

    @Test
    void reapRemovesDeadOwnedSubscriptionsOnly() {
        InMemoryQueueBackend backend = new InMemoryQueueBackend();
        backend.registerSubscription("orders", "ghost", EMAIL.name(), "default", false, "gone-worker");
        backend.registerSubscription("orders", "durable", EMAIL.name(), "default", true, null);

        assertEquals(1, backend.reapEphemeralSubscriptions());
        assertEquals(0, backend.reapEphemeralSubscriptions());
        assertTrue(backend.listSubscriptionsJson("orders").contains("durable"));
        assertFalse(backend.listSubscriptionsJson("orders").contains("ghost"));
    }
}
