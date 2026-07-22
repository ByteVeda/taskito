package org.byteveda.taskito.dashboard;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Path;
import org.byteveda.taskito.Taskito;
import org.byteveda.taskito.model.EffectiveRetention;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.api.io.TempDir;

/** The retention echo: the windows the elected cleaner publishes for this namespace. */
@Timeout(30)
class DashboardRetentionTest {

    private static final long DAY_MS = 86_400_000L;

    /** The document the elected cleaner publishes — see {@code BINDING_CONTRACT.md}. */
    private static final String PUBLISHED_KEY = "retention:effective:default";

    private static final String PUBLISHED = "{\"enabled\":true,\"defaulted\":true,\"namespace\":\"default\","
            + "\"reported_at\":1753200000000,\"windows\":{\"archived_jobs_ttl_ms\":604800000,"
            + "\"dead_letter_ttl_ms\":2592000000,\"task_logs_ttl_ms\":259200000,"
            + "\"task_metrics_ttl_ms\":604800000,\"job_errors_ttl_ms\":null}}";

    private static Taskito queue(Path dir) {
        return Taskito.builder().sqlite(dir.resolve("t.db").toString()).open();
    }

    @Test
    void effectiveRetentionIsEmptyUntilACleanerPublishes(@TempDir Path dir) {
        try (Taskito queue = queue(dir)) {
            // Unreported is not "off": no worker has swept, so nothing is known yet.
            assertTrue(queue.effectiveRetention().isEmpty());
        }
    }

    @Test
    void effectiveRetentionParsesThePublishedDocument(@TempDir Path dir) {
        try (Taskito queue = queue(dir)) {
            queue.setSetting(PUBLISHED_KEY, PUBLISHED);

            EffectiveRetention snapshot = queue.effectiveRetention().orElseThrow();
            assertTrue(snapshot.enabled);
            assertTrue(snapshot.defaulted);
            assertEquals("default", snapshot.namespace);
            assertEquals(1753200000000L, snapshot.reportedAt);
            assertEquals(3 * DAY_MS, snapshot.windows.taskLogsMs);
            assertEquals(30 * DAY_MS, snapshot.windows.deadLetterMs);
            // A table with no window is kept forever, not purged.
            assertEquals(null, snapshot.windows.jobErrorsMs);
        }
    }

    @Test
    void retentionEndpointReportsNothingBeforeASweep(@TempDir Path dir) throws Exception {
        try (Taskito queue = queue(dir);
                DashboardServer server = DashboardServer.start(queue, 0)) {
            DashboardClient client = new DashboardClient(server.port()).as(DashboardClient.seedAdmin(queue));

            String body = client.get("/api/retention").body();
            assertTrue(body.contains("\"reported\":false"), body);
            assertTrue(body.contains("\"enabled\":false"), body);
            assertTrue(body.contains("\"namespace\":null"), body);
            assertTrue(body.contains("\"task_logs_ttl_ms\":null"), body);
        }
    }

    @Test
    void retentionEndpointEchoesThePublishedWindows(@TempDir Path dir) throws Exception {
        try (Taskito queue = queue(dir);
                DashboardServer server = DashboardServer.start(queue, 0)) {
            DashboardClient client = new DashboardClient(server.port()).as(DashboardClient.seedAdmin(queue));
            queue.setSetting(PUBLISHED_KEY, PUBLISHED);

            String body = client.get("/api/retention").body();
            assertTrue(body.contains("\"reported\":true"), body);
            assertTrue(body.contains("\"defaulted\":true"), body);
            assertTrue(body.contains("\"reported_at\":1753200000000"), body);
            assertTrue(body.contains("\"task_logs_ttl_ms\":259200000"), body);
            assertTrue(body.contains("\"dead_letter_ttl_ms\":2592000000"), body);
        }
    }

    @Test
    void publishedWindowsAreNotAnEditableSetting(@TempDir Path dir) throws Exception {
        try (Taskito queue = queue(dir);
                DashboardServer server = DashboardServer.start(queue, 0)) {
            DashboardClient client = new DashboardClient(server.port()).as(DashboardClient.seedAdmin(queue));
            queue.setSetting(PUBLISHED_KEY, PUBLISHED);

            // A report of what the worker does, not a knob: never listed as an
            // editable row, never spoofable through the generic KV endpoints.
            assertFalse(client.get("/api/settings").body().contains(PUBLISHED_KEY));
            assertEquals(404, client.get("/api/settings/" + PUBLISHED_KEY).statusCode());
            assertEquals(
                    400,
                    client.put("/api/settings/" + PUBLISHED_KEY, "{\"value\":\"{}\"}")
                            .statusCode());
        }
    }
}
