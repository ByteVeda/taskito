package org.byteveda.taskito.webhooks;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.byteveda.taskito.Taskito;
import org.byteveda.taskito.errors.WebhookException;
import org.byteveda.taskito.events.OutcomeEvent;
import org.byteveda.taskito.logging.TaskitoLogger;
import org.byteveda.taskito.middleware.Middleware;

/**
 * Manages webhook subscriptions and dispatches matching job outcomes to them.
 * {@link #attach} registers the manager as queue middleware so outcomes are
 * delivered automatically. Persisted via the queue's settings store.
 */
public final class WebhookManager implements Middleware {
    private static final TaskitoLogger LOG = TaskitoLogger.create("webhooks");
    private static final ObjectMapper JSON = new ObjectMapper();
    // Dispatch runs on the worker's single outcome-drain thread for every job, so
    // it must not re-read + re-parse the settings blob per outcome. Local
    // create/delete invalidate immediately; the TTL bounds staleness from writers
    // in other processes.
    private static final long CACHE_TTL_MS = 30_000;

    private final WebhookStore store;
    private final Deliverer deliverer = new Deliverer();
    private volatile CachedHooks cached;

    private WebhookManager(Taskito queue) {
        this.store = new WebhookStore(queue);
    }

    /** Create a manager and register it on {@code queue} for automatic dispatch. */
    public static WebhookManager attach(Taskito queue) {
        WebhookManager manager = new WebhookManager(queue);
        queue.use(manager);
        return manager;
    }

    public synchronized Webhook create(Webhook.Builder spec) {
        long now = System.currentTimeMillis();
        Webhook hook = new Webhook(
                UUID.randomUUID().toString(),
                spec.url,
                new ArrayList<>(spec.events),
                spec.taskFilter,
                new LinkedHashMap<>(spec.headers),
                spec.secret,
                spec.maxRetries,
                spec.timeoutMs,
                spec.enabled,
                spec.description,
                now,
                now);
        List<Webhook> all = store.load();
        all.add(hook);
        store.save(all);
        cached = null;
        return hook;
    }

    public List<Webhook> list() {
        return store.load();
    }

    public Optional<Webhook> get(String id) {
        return store.load().stream().filter(hook -> hook.id.equals(id)).findFirst();
    }

    public synchronized boolean delete(String id) {
        List<Webhook> all = store.load();
        boolean removed = all.removeIf(hook -> hook.id.equals(id));
        if (removed) {
            store.save(all);
            cached = null;
        }
        return removed;
    }

    @Override
    public void onCompleted(OutcomeEvent event) {
        dispatch(event);
    }

    @Override
    public void onRetry(OutcomeEvent event) {
        dispatch(event);
    }

    @Override
    public void onDeadLetter(OutcomeEvent event) {
        dispatch(event);
    }

    @Override
    public void onCancel(OutcomeEvent event) {
        dispatch(event);
    }

    private void dispatch(OutcomeEvent event) {
        List<Webhook> hooks = activeHooks();
        if (hooks.isEmpty()) {
            return;
        }
        String wire = event.name.name().toLowerCase(Locale.ROOT);
        byte[] body = payload(event, wire);
        for (Webhook hook : hooks) {
            if (hook.enabled && hook.events.contains(wire) && matches(hook.taskFilter, event.taskName)) {
                try {
                    deliverer.deliver(hook, body);
                } catch (RuntimeException e) {
                    // A bad hook (e.g. malformed URL) must not block the rest. Log the
                    // class only — URI parse messages can echo the URL's tokens.
                    LOG.warn("webhook " + hook.id + " delivery failed: "
                            + e.getClass().getSimpleName());
                }
            }
        }
    }

    private List<Webhook> activeHooks() {
        CachedHooks snapshot = cached;
        long now = System.currentTimeMillis();
        if (snapshot == null || now - snapshot.loadedAt() > CACHE_TTL_MS) {
            snapshot = new CachedHooks(List.copyOf(store.load()), now);
            cached = snapshot;
        }
        return snapshot.hooks();
    }

    /** An immutable webhook list plus when it was read from the store. */
    private record CachedHooks(List<Webhook> hooks, long loadedAt) {}

    private static boolean matches(String filter, String taskName) {
        return filter == null || filter.equals(taskName);
    }

    private static byte[] payload(OutcomeEvent event, String wire) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("event", wire);
        body.put("job_id", event.jobId);
        body.put("task_name", event.taskName);
        body.put("error", event.error);
        body.put("retry_count", event.retryCount);
        body.put("timed_out", event.timedOut);
        try {
            return JSON.writeValueAsBytes(body);
        } catch (Exception e) {
            throw new WebhookException("webhook payload encoding failed", e);
        }
    }
}
