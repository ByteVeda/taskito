package org.byteveda.taskito.dashboard.api;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.stream.Collectors;
import org.byteveda.taskito.Taskito;
import org.byteveda.taskito.dashboard.support.Http;
import org.byteveda.taskito.model.JobFilter;
import org.byteveda.taskito.model.JobStatus;

/**
 * Read and action handlers for jobs, queues, dead-letters, metrics, and
 * workers. Each returns the snake_case JSON body (via {@link Contract}) or
 * {@code null} to signal 404.
 */
public final class CoreHandlers {
    private static final long DEFAULT_LIMIT = 50;

    private final Taskito queue;

    public CoreHandlers(Taskito queue) {
        this.queue = queue;
    }

    public Object stats() {
        return Contract.stats(queue.stats());
    }

    public Object statsByQueue() {
        Map<String, Object> out = new LinkedHashMap<>();
        queue.statsAllQueues().forEach((name, stats) -> out.put(name, Contract.stats(stats)));
        return out;
    }

    public Object queuesPaused() {
        return queue.listPausedQueues();
    }

    public Object listJobs(Map<String, String> query) {
        JobFilter.Builder filter = JobFilter.builder();
        if (query.containsKey("status")) {
            filter.status(JobStatus.fromWire(query.get("status")));
        }
        if (query.containsKey("queue")) {
            filter.queue(query.get("queue"));
        }
        if (query.containsKey("task")) {
            filter.task(query.get("task"));
        }
        if (query.containsKey("limit")) {
            filter.limit(Http.intParam(query, "limit", 0));
        }
        if (query.containsKey("offset")) {
            filter.offset(Http.intParam(query, "offset", 0));
        }
        return queue.listJobs(filter.build()).stream().map(Contract::job).collect(Collectors.toList());
    }

    public Object job(String id) {
        return queue.getJob(id).map(Contract::job).orElse(null);
    }

    public Object listDead(Map<String, String> query) {
        long limit = Http.longParam(query, "limit", DEFAULT_LIMIT);
        long offset = Http.longParam(query, "offset", 0);
        return queue.listDead(limit, offset).stream().map(Contract::dead).collect(Collectors.toList());
    }

    public Object listWorkers() {
        return queue.listWorkers().stream().map(Contract::worker).collect(Collectors.toList());
    }

    public Object cancel(String id) {
        return Map.of("cancelled", queue.cancel(id));
    }

    public Object retryDead(String id) {
        return Map.of("id", queue.retryDead(id));
    }

    public Object pause(String name) {
        queue.queue(name).pause();
        return Map.of("ok", true);
    }

    public Object resume(String name) {
        queue.queue(name).resume();
        return Map.of("ok", true);
    }
}
