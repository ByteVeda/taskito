package org.byteveda.taskito.dashboard;

import java.util.LinkedHashMap;
import java.util.Map;
import org.byteveda.taskito.model.DeadJob;
import org.byteveda.taskito.model.Job;
import org.byteveda.taskito.model.QueueStats;
import org.byteveda.taskito.model.TaskMetric;
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
        m.put("tags", w.tags);
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

    static Map<String, Object> metric(TaskMetric t) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("task_name", t.taskName);
        m.put("job_id", t.jobId);
        m.put("wall_time_ns", t.wallTimeNs);
        m.put("memory_bytes", t.memoryBytes);
        m.put("succeeded", t.succeeded);
        m.put("recorded_at", t.recordedAt);
        return m;
    }
}
