package org.byteveda.taskito.dashboard.api;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.function.BinaryOperator;
import java.util.stream.Collectors;
import org.byteveda.taskito.Taskito;
import org.byteveda.taskito.dashboard.support.Http;
import org.byteveda.taskito.dashboard.support.Json;
import org.byteveda.taskito.events.EventName;
import org.byteveda.taskito.model.QueueStats;
import org.byteveda.taskito.model.WorkerInfo;

/**
 * Operational endpoints: circuit breakers, event types, the KEDA scaler payload,
 * readiness, and the Prometheus exposition. The scaler and Prometheus outputs are
 * computed purely from stats + workers.
 */
public final class OpsHandlers {
    private static final long DEFAULT_TARGET_QUEUE_DEPTH = 10;

    private final Taskito queue;

    public OpsHandlers(Taskito queue) {
        this.queue = queue;
    }

    public Object circuitBreakers() {
        return queue.listCircuitBreakers().stream()
                .map(Contract::circuitBreaker)
                .collect(Collectors.toList());
    }

    public Object eventTypes() {
        List<String> types = new ArrayList<>();
        for (EventName name : EventName.values()) {
            types.add(name.name().toLowerCase(Locale.ROOT));
        }
        return types;
    }

    public Object scaler(Map<String, String> query) {
        String queueName = query.get("queue");
        long target = Http.longParam(query, "target", DEFAULT_TARGET_QUEUE_DEPTH);
        QueueStats stats = queueName == null ? queue.stats() : queue.statsByQueue(queueName);
        List<WorkerInfo> workers = queue.listWorkers();
        long capacity = workers.stream().mapToLong(w -> w.threads).sum();

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("metric_name", queueName == null ? "taskito_queue_depth" : "taskito_queue_depth_" + queueName);
        out.put("metric_value", stats.pending);
        out.put("target_queue_depth", target);
        out.put("is_active", stats.pending > 0 || stats.running > 0);
        out.put("live_workers", workers.size());
        out.put("total_capacity", capacity);
        if (queueName == null) {
            Map<String, Object> perQueue = new LinkedHashMap<>();
            queue.statsAllQueues().forEach((name, s) -> perQueue.put(name, s.pending));
            out.put("per_queue", perQueue);
        }
        return out;
    }

    /**
     * Per-resource status aggregated across workers, derived from each worker's
     * advertised {@code resources} + reported {@code resourceHealth}. A resource
     * a worker advertises but never reports on is {@code not_initialized}; when
     * workers disagree, the worst health wins.
     */
    public Object resources() {
        Map<String, Integer> reported = new TreeMap<>();
        Set<String> advertised = new TreeSet<>();
        for (WorkerInfo worker : queue.listWorkers()) {
            advertised.addAll(Json.parseStringList(worker.resources));
            Map<String, Object> health = Json.parseMap(worker.resourceHealth);
            if (health != null) {
                // BinaryOperator.maxBy keeps the merge on boxed Integers — Math::max
                // would funnel both arguments through an unchecked Integer->int unboxing.
                health.forEach((name, value) -> reported.merge(
                        name, severity(String.valueOf(value)), BinaryOperator.maxBy(Comparator.naturalOrder())));
            }
        }
        Set<String> all = new TreeSet<>(advertised);
        all.addAll(reported.keySet());
        List<Map<String, Object>> out = new ArrayList<>();
        for (String name : all) {
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("name", name);
            entry.put("scope", "worker");
            entry.put("health", reported.containsKey(name) ? healthName(reported.get(name)) : "not_initialized");
            entry.put("init_duration_ms", 0);
            entry.put("recreations", 0);
            entry.put("depends_on", List.of());
            out.add(entry);
        }
        return out;
    }

    private static int severity(String health) {
        return switch (health) {
            case "unhealthy" -> 2;
            case "degraded" -> 1;
            default -> 0;
        };
    }

    private static String healthName(int severity) {
        return switch (severity) {
            case 2 -> "unhealthy";
            case 1 -> "degraded";
            default -> "healthy";
        };
    }

    public Object readiness() {
        Map<String, Object> checks = new LinkedHashMap<>();
        checks.put("storage", true);
        checks.put("workers", queue.listWorkers().size());
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("status", "ready");
        out.put("checks", checks);
        return out;
    }

    /** Prometheus text exposition of the queue's job counts and worker count. */
    public String prometheus() {
        QueueStats stats = queue.stats();
        StringBuilder sb = new StringBuilder();
        gauge(sb, "taskito_jobs_pending", "Jobs waiting to run", stats.pending);
        gauge(sb, "taskito_jobs_running", "Jobs currently running", stats.running);
        gauge(sb, "taskito_jobs_completed", "Jobs completed", stats.completed);
        gauge(sb, "taskito_jobs_failed", "Jobs failed", stats.failed);
        gauge(sb, "taskito_jobs_dead", "Jobs dead-lettered", stats.dead);
        gauge(sb, "taskito_jobs_cancelled", "Jobs cancelled", stats.cancelled);
        gauge(sb, "taskito_workers", "Registered workers", queue.listWorkers().size());
        return sb.toString();
    }

    private static void gauge(StringBuilder sb, String name, String help, long value) {
        sb.append("# HELP ").append(name).append(' ').append(help).append('\n');
        sb.append("# TYPE ").append(name).append(" gauge\n");
        sb.append(name).append(' ').append(value).append('\n');
    }
}
