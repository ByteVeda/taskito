package org.byteveda.taskito.dashboard.api;

import java.util.LinkedHashMap;
import java.util.Map;
import org.byteveda.taskito.model.CircuitBreakerState;
import org.byteveda.taskito.model.DeadJob;
import org.byteveda.taskito.model.Job;
import org.byteveda.taskito.model.QueueStats;
import org.byteveda.taskito.model.WorkerInfo;

/**
 * Maps the SDK's camelCase types to the snake_case JSON contract the React SPA
 * expects. Timestamps are Unix milliseconds throughout (never scaled).
 */
final class Contract {
    private Contract() {}

    static Map<String, Object> stats(QueueStats s) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("pending", s.pending);
        m.put("running", s.running);
        m.put("completed", s.completed);
        m.put("failed", s.failed);
        m.put("dead", s.dead);
        m.put("cancelled", s.cancelled);
        return m;
    }

    static Map<String, Object> job(Job j) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", j.id);
        m.put("task_name", j.taskName);
        m.put("queue", j.queue);
        m.put("status", j.status.wire());
        m.put("priority", j.priority);
        m.put("progress", j.progress);
        m.put("retry_count", j.retryCount);
        m.put("max_retries", j.maxRetries);
        m.put("created_at", j.createdAt);
        m.put("scheduled_at", j.scheduledAt);
        m.put("started_at", j.startedAt);
        m.put("completed_at", j.completedAt);
        m.put("timeout_ms", j.timeoutMs);
        m.put("error", j.error);
        m.put("unique_key", j.uniqueKey);
        m.put("namespace", j.namespace);
        m.put("notes", j.notes);
        return m;
    }

    static Map<String, Object> worker(WorkerInfo w) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("worker_id", w.workerId);
        m.put("queues", w.queues);
        m.put("status", w.status);
        m.put("last_heartbeat", w.lastHeartbeat);
        m.put("registered_at", w.startedAt == null ? w.lastHeartbeat : w.startedAt);
        m.put("hostname", w.hostname);
        m.put("pid", w.pid);
        m.put("pool_type", w.poolType);
        m.put("threads", w.threads);
        m.put("tags", w.tags);
        return m;
    }

    static Map<String, Object> circuitBreaker(CircuitBreakerState c) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("task_name", c.taskName);
        m.put("state", c.state);
        m.put("failure_count", c.failureCount);
        m.put("threshold", c.threshold);
        m.put("window_ms", c.windowMs);
        m.put("cooldown_ms", c.cooldownMs);
        m.put("opened_at", c.openedAt);
        m.put("last_failure_at", c.lastFailureAt);
        m.put("half_open_max_probes", c.halfOpenMaxProbes);
        m.put("half_open_success_rate", c.halfOpenSuccessRate);
        return m;
    }

    static Map<String, Object> dead(DeadJob d) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", d.id);
        m.put("original_job_id", d.originalJobId);
        m.put("task_name", d.taskName);
        m.put("queue", d.queue);
        m.put("error", d.error);
        m.put("retry_count", d.retryCount);
        m.put("failed_at", d.failedAt);
        m.put("metadata", d.metadata);
        m.put("dlq_retry_count", d.dlqRetryCount);
        return m;
    }
}
