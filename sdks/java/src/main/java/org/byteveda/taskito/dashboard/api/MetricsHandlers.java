package org.byteveda.taskito.dashboard.api;

import java.util.Map;
import org.byteveda.taskito.Taskito;

/**
 * Aggregated metrics endpoints. {@code /api/metrics} returns the per-task
 * summary the SPA expects (not raw rows); {@code /api/metrics/timeseries}
 * returns time-bucketed points. Both aggregate raw {@link org.byteveda.taskito.model.TaskMetric}
 * rows in pure Java via {@link Metrics}.
 */
public final class MetricsHandlers {
    private static final long DEFAULT_BUCKET_MS = 60_000;

    private final Taskito queue;

    public MetricsHandlers(Taskito queue) {
        this.queue = queue;
    }

    public Object aggregated(Map<String, String> query) {
        return Metrics.aggregateByTask(queue.metrics(query.get("task"), longParam(query, "since", 0)));
    }

    public Object timeseries(Map<String, String> query) {
        long since = longParam(query, "since", 0);
        long bucket = longParam(query, "bucket", DEFAULT_BUCKET_MS);
        return Metrics.timeseries(queue.metrics(query.get("task"), since), bucket);
    }

    private static long longParam(Map<String, String> query, String key, long fallback) {
        String value = query.get(key);
        return value == null ? fallback : Long.parseLong(value);
    }
}
