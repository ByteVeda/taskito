package org.byteveda.taskito;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Path;
import org.byteveda.taskito.scaler.Scaler;
import org.byteveda.taskito.scaler.ScalerOptions;
import org.byteveda.taskito.task.Task;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.api.io.TempDir;

class ScalerTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Task<Integer> TASK = Task.of("s.task", Integer.class);

    @Test
    @Timeout(30)
    void reportsQueueDepthAndHealth(@TempDir Path dir) throws Exception {
        try (Taskito queue =
                Taskito.builder().url(dir.resolve("s.db").toString()).open()) {
            queue.enqueue(TASK, 1);
            queue.enqueue(TASK, 2);
            try (Scaler scaler = Scaler.start(queue, new ScalerOptions(0, "127.0.0.1", 5, null))) {
                HttpClient client = HttpClient.newHttpClient();
                String base = "http://127.0.0.1:" + scaler.port();

                HttpResponse<String> scale = get(client, base + "/api/scaler");
                assertEquals(200, scale.statusCode());
                JsonNode body = JSON.readTree(scale.body());
                assertEquals(2, body.get("metricValue").asLong());
                assertEquals(5, body.get("targetValue").asInt());
                assertEquals("all", body.get("queueName").asText());

                HttpResponse<String> health = get(client, base + "/health");
                assertEquals(200, health.statusCode());
                assertEquals("ok", JSON.readTree(health.body()).get("status").asText());
            }
        }
    }

    @Test
    void rejectsNonPositiveTarget() {
        assertThrows(IllegalArgumentException.class, () -> new ScalerOptions(0, "127.0.0.1", 0, null));
    }

    private static HttpResponse<String> get(HttpClient client, String url) throws Exception {
        return client.send(HttpRequest.newBuilder(URI.create(url)).GET().build(), HttpResponse.BodyHandlers.ofString());
    }
}
