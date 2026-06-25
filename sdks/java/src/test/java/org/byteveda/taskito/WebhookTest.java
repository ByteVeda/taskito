package org.byteveda.taskito;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Path;
import org.byteveda.taskito.events.EventName;
import org.byteveda.taskito.webhooks.Webhook;
import org.byteveda.taskito.webhooks.WebhookManager;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class WebhookTest {

    @Test
    void crudRoundTrip(@TempDir Path dir) {
        try (Queue queue =
                Taskito.builder().backend("sqlite").url(dir.resolve("t.db").toString()).open()) {
            WebhookManager webhooks = WebhookManager.attach(queue);

            Webhook created = webhooks.create(Webhook.builder("http://example/hook")
                    .on(EventName.SUCCESS, EventName.DEAD)
                    .secret("s"));
            assertNotNull(created.id);
            assertEquals(2, created.events.size());

            assertEquals(1, webhooks.list().size());
            assertTrue(webhooks.get(created.id).isPresent());
            assertTrue(webhooks.get(created.id).get().events.contains("success"));

            assertTrue(webhooks.delete(created.id));
            assertTrue(webhooks.list().isEmpty());
            assertFalse(webhooks.delete(created.id));
        }
    }
}
