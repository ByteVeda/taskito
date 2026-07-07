package org.byteveda.taskito.dashboard;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpResponse.BodyHandlers;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.byteveda.taskito.Taskito;
import org.byteveda.taskito.dashboard.auth.AuthStore;
import org.byteveda.taskito.dashboard.auth.oauth.OAuthFlow;
import org.byteveda.taskito.dashboard.auth.oauth.OAuthStateStore;
import org.byteveda.taskito.dashboard.auth.oauth.config.OAuthConfig;
import org.byteveda.taskito.dashboard.auth.oauth.provider.OAuthProvider;
import org.byteveda.taskito.dashboard.oauth.FakeOAuthProvider;
import org.byteveda.taskito.dashboard.store.SettingsAccess;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.api.io.TempDir;

/** Wires an OAuth flow into the live dashboard server and exercises the public routes. */
@Timeout(30)
class DashboardOAuthTest {

    private static Taskito open(Path dir) {
        return Taskito.builder().sqlite(dir.resolve("t.db").toString()).open();
    }

    private static OAuthFlow fakeFlow(Taskito queue) {
        OAuthConfig config = new OAuthConfig("https://dash.example", null, null, List.of(), true, List.of());
        SettingsAccess settings = SettingsAccess.of(queue);
        Map<String, OAuthProvider> providers = Map.of("fake", new FakeOAuthProvider("fake", "Fake", "oidc"));
        return new OAuthFlow(new AuthStore(settings), config, new OAuthStateStore(settings), providers);
    }

    private static HttpResponse<String> get(int port, String path) throws Exception {
        HttpClient client = HttpClient.newBuilder()
                .followRedirects(HttpClient.Redirect.NEVER)
                .build();
        HttpRequest request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                .GET()
                .build();
        return client.send(request, BodyHandlers.ofString());
    }

    @Test
    void providersEndpointListsConfiguredProvider(@TempDir Path dir) throws Exception {
        try (Taskito queue = open(dir);
                DashboardServer server = DashboardServer.startWithOAuth(queue, 0, false, fakeFlow(queue))) {
            HttpResponse<String> resp = get(server.port(), "/api/auth/providers");
            assertEquals(200, resp.statusCode());
            assertTrue(resp.body().contains("\"password_enabled\":true"));
            assertTrue(resp.body().contains("\"slot\":\"fake\""));
            assertTrue(resp.body().contains("\"label\":\"Fake\""));
        }
    }

    @Test
    void startRedirectsToProviderAuthorizeUrl(@TempDir Path dir) throws Exception {
        try (Taskito queue = open(dir);
                DashboardServer server = DashboardServer.startWithOAuth(queue, 0, false, fakeFlow(queue))) {
            HttpResponse<String> resp = get(server.port(), "/api/auth/oauth/start/fake");
            assertEquals(302, resp.statusCode());
            assertTrue(
                    resp.headers().firstValue("Location").orElse("").startsWith("https://provider.example/authorize"));
        }
    }

    @Test
    void startUnknownSlotReports404(@TempDir Path dir) throws Exception {
        try (Taskito queue = open(dir);
                DashboardServer server = DashboardServer.startWithOAuth(queue, 0, false, fakeFlow(queue))) {
            assertEquals(
                    404, get(server.port(), "/api/auth/oauth/start/missing").statusCode());
        }
    }
}
