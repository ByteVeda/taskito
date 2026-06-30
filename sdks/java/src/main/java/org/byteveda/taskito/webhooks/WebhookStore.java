package org.byteveda.taskito.webhooks;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.type.CollectionType;
import java.util.ArrayList;
import java.util.List;
import org.byteveda.taskito.Taskito;
import org.byteveda.taskito.errors.WebhookException;

/** Persists webhooks as a JSON list in the queue's settings key/value store. */
final class WebhookStore {
    private static final String KEY = "taskito.webhooks";
    private static final ObjectMapper JSON = new ObjectMapper();

    private final Taskito queue;

    WebhookStore(Taskito queue) {
        this.queue = queue;
    }

    List<Webhook> load() {
        return queue.getSetting(KEY).map(WebhookStore::parse).orElseGet(ArrayList::new);
    }

    void save(List<Webhook> webhooks) {
        try {
            queue.setSetting(KEY, JSON.writeValueAsString(webhooks));
        } catch (Exception e) {
            throw new WebhookException("failed to persist webhooks", e);
        }
    }

    private static List<Webhook> parse(String json) {
        try {
            CollectionType type = JSON.getTypeFactory().constructCollectionType(List.class, Webhook.class);
            return JSON.readValue(json, type);
        } catch (Exception e) {
            throw new WebhookException("failed to read webhooks", e);
        }
    }
}
