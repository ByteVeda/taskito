package org.byteveda.taskito;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Path;
import java.util.Collections;
import java.util.Map;
import org.byteveda.taskito.dashboard.DashboardServer;
import org.byteveda.taskito.task.EnqueueOptions;
import org.byteveda.taskito.task.Task;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.api.io.TempDir;

class DashboardTest {

    @SuppressWarnings("unchecked")
    private static Class<Map<String, Object>> mapType() {
        return (Class<Map<String, Object>>) (Class<?>) Map.class;
    }

    private static HttpResponse<String> get(int port, String path) throws Exception {
        return HttpClient.newHttpClient()
                .send(
                        HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                                .GET()
                                .build(),
                        HttpResponse.BodyHandlers.ofString());
    }

    @Test
    @Timeout(30)
    void servesSnakeCaseContract(@TempDir Path dir) throws Exception {
        Task<Map<String, Object>> add = Task.of("add", mapType());
        try (Queue queue = Taskito.builder()
                .backend("sqlite")
                .url(dir.resolve("t.db").toString())
                .open()) {
            queue.enqueue(
                    add,
                    Collections.singletonMap("a", 1),
                    EnqueueOptions.builder().queue("emails").build());
            try (DashboardServer server = DashboardServer.start(queue, 0)) {
                int port = server.port();

                HttpResponse<String> stats = get(port, "/api/stats");
                assertEquals(200, stats.statusCode());
                assertTrue(stats.body().contains("\"pending\":1"));

                HttpResponse<String> jobs = get(port, "/api/jobs?queue=emails");
                assertTrue(jobs.body().contains("\"task_name\":\"add\""));
                assertTrue(jobs.body().contains("\"status\":\"pending\""));
            }
        }
    }

    @Test
    @Timeout(30)
    void enforcesToken(@TempDir Path dir) throws Exception {
        try (Queue queue = Taskito.builder()
                .backend("sqlite")
                .url(dir.resolve("t.db").toString())
                .open()) {
            try (DashboardServer server = DashboardServer.start(queue, 0, "sekret", null)) {
                int port = server.port();
                assertEquals(401, get(port, "/api/stats").statusCode());
                assertEquals(200, get(port, "/api/stats?token=sekret").statusCode());
            }
        }
    }
}
