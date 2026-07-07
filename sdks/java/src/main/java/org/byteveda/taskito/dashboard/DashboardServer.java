package org.byteveda.taskito.dashboard;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executors;
import org.byteveda.taskito.Taskito;
import org.byteveda.taskito.dashboard.api.CoreHandlers;
import org.byteveda.taskito.dashboard.auth.AuthHandlers;
import org.byteveda.taskito.dashboard.auth.AuthStore;
import org.byteveda.taskito.dashboard.auth.Cookies;
import org.byteveda.taskito.dashboard.auth.Policy;
import org.byteveda.taskito.dashboard.auth.RequestContext;
import org.byteveda.taskito.dashboard.auth.TokenAuth;
import org.byteveda.taskito.dashboard.routing.Req;
import org.byteveda.taskito.dashboard.routing.Router;
import org.byteveda.taskito.dashboard.store.SettingsAccess;
import org.byteveda.taskito.dashboard.support.DashboardError;
import org.byteveda.taskito.dashboard.support.Http;
import org.byteveda.taskito.logging.TaskitoLogger;

/**
 * A read/action dashboard API + static-SPA server backed by a {@link Taskito},
 * built on the JDK's {@code com.sun.net.httpserver}. The JSON contract is
 * snake_case with Unix-millisecond timestamps.
 *
 * <p>Two auth modes:
 * <ul>
 *   <li><b>Session</b> (default): password users + sessions in the settings KV,
 *       CSRF double-submit, admin/viewer RBAC, first-run setup. Bootstrap an
 *       admin with {@code TASKITO_DASHBOARD_ADMIN_USER}/{@code _PASSWORD}.
 *   <li><b>Legacy token</b>: pass a shared {@code token} to gate {@code /api/*}
 *       as a fixed admin identity (no users/sessions). Kept for back-compat.
 * </ul>
 */
public final class DashboardServer implements AutoCloseable {
    private static final TaskitoLogger LOG = TaskitoLogger.create("dashboard");

    private final HttpServer server;
    private final Taskito queue;
    private final Path staticDir;
    private final boolean secureCookies;
    private final AuthStore authStore;
    private final TokenAuth tokenAuth;
    private final AuthHandlers authHandlers;
    private final Router router;

    private DashboardServer(HttpServer server, Taskito queue, Path staticDir, boolean secureCookies, String token) {
        this.server = server;
        this.queue = queue;
        this.staticDir = staticDir;
        this.secureCookies = secureCookies;
        this.authStore = new AuthStore(SettingsAccess.of(queue));
        this.tokenAuth = token != null ? new TokenAuth(token) : null;
        this.authHandlers = new AuthHandlers(authStore);
        this.router = buildRouter();
    }

    /** Start on {@code port} (0 = ephemeral) in session-auth mode. */
    public static DashboardServer start(Taskito queue, int port) throws IOException {
        return start(queue, port, null, null, true);
    }

    /** Start in legacy shared-token mode; the session flow is disabled. */
    public static DashboardServer start(Taskito queue, int port, String token) throws IOException {
        return start(queue, port, token, null, true);
    }

    /** As {@link #start(Taskito, int, String)} but with an unpacked SPA directory. */
    public static DashboardServer start(Taskito queue, int port, String token, String staticDir) throws IOException {
        return start(queue, port, token, staticDir, true);
    }

    /**
     * Start on {@code port} (0 = ephemeral). A null {@code token} enables the
     * session flow; a null {@code staticDir} auto-discovers the bundled SPA.
     * {@code secureCookies=false} drops the {@code Secure} cookie attribute for
     * local HTTP development.
     */
    public static DashboardServer start(Taskito queue, int port, String token, String staticDir, boolean secureCookies)
            throws IOException {
        // Resolve assets before binding so a discovery failure can't leak a bound port.
        Path dir = staticDir != null ? Paths.get(staticDir).normalize() : DashboardAssets.resolveOrNull();
        HttpServer server = HttpServer.create(new InetSocketAddress(port), 0);
        DashboardServer dashboard = new DashboardServer(server, queue, dir, secureCookies, token);
        // Seed an env admin before serving so no request races the open setup endpoint.
        if (token == null) {
            dashboard.authStore.bootstrapAdminFromEnv();
        }
        server.createContext("/", dashboard::dispatch);
        server.setExecutor(Executors.newCachedThreadPool());
        server.start();
        return dashboard;
    }

    public int port() {
        return server.getAddress().getPort();
    }

    @Override
    public void close() {
        server.stop(0);
    }

    // ---- dispatch ----------------------------------------------------------

    private void dispatch(HttpExchange exchange) throws IOException {
        try {
            String path = exchange.getRequestURI().getPath();
            if (path.equals("/health")) {
                Http.respondJson(exchange, 200, Map.of("status", "ok"));
            } else if (path.startsWith("/api/")) {
                handleApi(exchange, path);
            } else {
                serveStatic(exchange, path);
            }
        } catch (DashboardError e) {
            safeRespond(exchange, e.status(), Http.errorBody(e.code()));
        } catch (RuntimeException | IOException e) {
            // Log the detail server-side; return a generic code so an unauthenticated
            // caller can't harvest internal exception text (e.g. from a malformed cookie).
            LOG.warn("dashboard request failed: " + exchange.getRequestMethod() + " " + exchange.getRequestURI(), e);
            safeRespond(exchange, 500, Http.errorBody("internal_error"));
        } finally {
            exchange.close();
        }
    }

    private void handleApi(HttpExchange exchange, String path) throws IOException {
        Map<String, String> query = Http.query(exchange);
        String method = exchange.getRequestMethod();
        if (tokenAuth != null) {
            handleTokenMode(exchange, path, method, query);
            return;
        }
        RequestContext ctx = RequestContext.build(exchange, authStore);
        Policy.authorize(path, method, ctx, authStore);
        if (!router.dispatch(exchange, method, path, query, ctx)) {
            Http.respondError(exchange, 404, "not found");
        }
    }

    private void handleTokenMode(HttpExchange exchange, String path, String method, Map<String, String> query)
            throws IOException {
        String queryToken = query.get("token");
        if (queryToken != null && tokenAuth.matches(queryToken)) {
            exchange.getResponseHeaders().add("Set-Cookie", TokenAuth.openCookie(queryToken, secureCookies));
        }
        if (path.equals("/api/auth/status")) {
            Http.respondJson(exchange, 200, TokenAuth.openStatus());
            return;
        }
        if (!tokenAuth.matches(tokenAuth.presented(exchange, query))) {
            Http.respondError(exchange, 401, "unauthorized");
            return;
        }
        if (path.equals("/api/auth/whoami")) {
            long ttl = AuthStore.DEFAULT_SESSION_TTL_SECONDS;
            exchange.getResponseHeaders().add("Set-Cookie", Cookies.sessionCookie("open", secureCookies, ttl));
            exchange.getResponseHeaders().add("Set-Cookie", Cookies.csrfCookie("open", secureCookies, ttl));
            Http.respondJson(exchange, 200, TokenAuth.openWhoami());
            return;
        }
        if (path.startsWith("/api/auth/")) {
            Http.respondError(exchange, 404, "not found");
            return;
        }
        if (!router.dispatch(exchange, method, path, query, RequestContext.open())) {
            Http.respondError(exchange, 404, "not found");
        }
    }

    // ---- routes ------------------------------------------------------------

    private Router buildRouter() {
        CoreHandlers core = new CoreHandlers(queue);
        long ttl = AuthStore.DEFAULT_SESSION_TTL_SECONDS;
        Router r = new Router();

        // Auth
        r.get("/api/auth/status", req -> authHandlers.status());
        r.post("/api/auth/setup", req -> authHandlers.setup(req.jsonBody()));
        r.post("/api/auth/login", req -> login(req, ttl));
        r.post("/api/auth/logout", this::logout);
        r.get("/api/auth/whoami", req -> authHandlers.whoami(req.ctx()));
        r.post("/api/auth/change-password", req -> authHandlers.changePassword(req.ctx(), req.jsonBody()));
        r.get("/api/auth/providers", req -> Map.of("password_enabled", true, "providers", List.of()));
        r.get("/api/auth/oauth/start/(.+)", req -> {
            throw DashboardError.notFound("oauth_not_configured");
        });
        r.get("/api/auth/oauth/callback/(.+)", req -> {
            throw DashboardError.notFound("oauth_not_configured");
        });

        // Read
        r.get("/api/stats", req -> core.stats());
        r.get("/api/stats/queues", req -> core.statsByQueue());
        r.get("/api/queues/paused", req -> core.queuesPaused());
        r.get("/api/jobs", req -> core.listJobs(req.query()));
        r.get("/api/jobs/([^/]+)", req -> core.job(req.param(0)));
        r.get("/api/dead-letters", req -> core.listDead(req.query()));
        r.get("/api/metrics", req -> core.listMetrics(req.query()));
        r.get("/api/workers", req -> core.listWorkers());

        // Action
        r.post("/api/jobs/([^/]+)/cancel", req -> core.cancel(req.param(0)));
        r.post("/api/dead-letters/([^/]+)/retry", req -> core.retryDead(req.param(0)));
        r.post("/api/queues/([^/]+)/pause", req -> core.pause(req.param(0)));
        r.post("/api/queues/([^/]+)/resume", req -> core.resume(req.param(0)));

        return r;
    }

    private Object login(Req req, long ttl) {
        Map<String, Object> out = authHandlers.login(req.jsonBody());
        @SuppressWarnings("unchecked")
        Map<String, Object> session = (Map<String, Object>) out.get("session");
        String token = (String) session.remove("token");
        String csrf = (String) session.get("csrf_token");
        var headers = req.exchange().getResponseHeaders();
        headers.add("Set-Cookie", Cookies.sessionCookie(token, secureCookies, ttl));
        headers.add("Set-Cookie", Cookies.csrfCookie(csrf, secureCookies, ttl));
        return out;
    }

    private Object logout(Req req) {
        Map<String, Object> out = authHandlers.logout(req.ctx());
        var headers = req.exchange().getResponseHeaders();
        headers.add("Set-Cookie", Cookies.clearSession(secureCookies));
        headers.add("Set-Cookie", Cookies.clearCsrf(secureCookies));
        return out;
    }

    // ---- static + helpers --------------------------------------------------

    private void serveStatic(HttpExchange exchange, String path) throws IOException {
        if (staticDir == null) {
            Http.respondError(exchange, 404, "not found");
            return;
        }
        Path target = staticDir.resolve(path.substring(1)).normalize();
        if (!target.startsWith(staticDir) || !Files.isRegularFile(target)) {
            target = staticDir.resolve("index.html");
        }
        if (!Files.isRegularFile(target)) {
            Http.respondError(exchange, 404, "not found");
            return;
        }
        byte[] body = Files.readAllBytes(target);
        exchange.getResponseHeaders().set("Content-Type", contentType(target));
        exchange.sendResponseHeaders(200, body.length);
        try (OutputStream out = exchange.getResponseBody()) {
            out.write(body);
        }
    }

    private static void safeRespond(HttpExchange exchange, int status, Object body) {
        try {
            Http.respondJson(exchange, status, body);
        } catch (IOException | RuntimeException ignored) {
            // Response already partially written or the client disconnected.
        }
    }

    private static String contentType(Path file) {
        String name = file.getFileName().toString();
        if (name.endsWith(".html")) {
            return "text/html; charset=utf-8";
        }
        if (name.endsWith(".js")) {
            return "application/javascript";
        }
        if (name.endsWith(".css")) {
            return "text/css";
        }
        if (name.endsWith(".json")) {
            return "application/json";
        }
        if (name.endsWith(".svg")) {
            return "image/svg+xml";
        }
        return "application/octet-stream";
    }
}
