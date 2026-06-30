package org.byteveda.taskito.dashboard;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import org.byteveda.taskito.Taskito;
import org.byteveda.taskito.errors.SerializationException;
import org.byteveda.taskito.model.Job;
import org.byteveda.taskito.model.JobFilter;
import org.byteveda.taskito.model.JobStatus;

/**
 * A read/action dashboard API + static-SPA server backed by a {@link Taskito},
 * built on the JDK's {@code com.sun.net.httpserver}. The JSON contract is
 * snake_case with Unix-millisecond timestamps (see {@link Contract}).
 *
 * <p>When a {@code token} is configured, {@code /api/*} (except
 * {@code /api/auth/status}) requires it via {@code ?token=} or a cookie.
 */
public final class DashboardServer implements AutoCloseable {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String COOKIE = "taskito_token";
    private static final long DEFAULT_LIMIT = 50;

    private static final Pattern JOB = Pattern.compile("^/api/jobs/([^/]+)$");
    private static final Pattern CANCEL = Pattern.compile("^/api/jobs/([^/]+)/cancel$");
    private static final Pattern RETRY = Pattern.compile("^/api/dead-letters/([^/]+)/retry$");
    private static final Pattern PAUSE = Pattern.compile("^/api/queues/([^/]+)/pause$");
    private static final Pattern RESUME = Pattern.compile("^/api/queues/([^/]+)/resume$");

    private final HttpServer server;
    private final Taskito queue;
    private final String token;
    private final Path staticDir;

    private DashboardServer(HttpServer server, Taskito queue, String token, Path staticDir) {
        this.server = server;
        this.queue = queue;
        this.token = token;
        this.staticDir = staticDir;
    }

    /** Start on {@code port} (0 = ephemeral), serving the SPA bundled in the jar. */
    public static DashboardServer start(Taskito queue, int port) throws IOException {
        return start(queue, port, null, null);
    }

    /** As {@link #start(Taskito, int)} but requiring {@code token} for {@code /api/*}. */
    public static DashboardServer start(Taskito queue, int port, String token) throws IOException {
        return start(queue, port, token, null);
    }

    /**
     * Start on {@code port} (0 = ephemeral). {@code token} may be null. A null
     * {@code staticDir} auto-discovers the SPA bundled in the jar; pass one only
     * to override it with an unpacked build.
     */
    public static DashboardServer start(Taskito queue, int port, String token, String staticDir) throws IOException {
        // Resolve assets before binding so a discovery failure can't leak a bound port.
        Path dir = staticDir != null ? Paths.get(staticDir).normalize() : DashboardAssets.resolveOrNull();
        HttpServer server = HttpServer.create(new InetSocketAddress(port), 0);
        DashboardServer dashboard = new DashboardServer(server, queue, token, dir);
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

    private void dispatch(HttpExchange exchange) throws IOException {
        try {
            String path = exchange.getRequestURI().getPath();
            if (path.startsWith("/api/")) {
                handleApi(exchange, path);
            } else {
                serveStatic(exchange, path);
            }
        } catch (RuntimeException e) {
            respond(exchange, 500, error(e.getMessage() == null ? e.toString() : e.getMessage()));
        } finally {
            exchange.close();
        }
    }

    private void handleApi(HttpExchange exchange, String path) throws IOException {
        Map<String, String> query = query(exchange);
        if (path.equals("/api/auth/status")) {
            respond(exchange, 200, Collections.singletonMap("auth_required", token != null));
            return;
        }
        if (!authorized(exchange, query)) {
            respond(exchange, 401, error("unauthorized"));
            return;
        }

        String method = exchange.getRequestMethod();
        if ("GET".equals(method) && handleGet(exchange, path, query)) {
            return;
        }
        if ("POST".equals(method) && handlePost(exchange, path)) {
            return;
        }
        respond(exchange, 404, error("not found"));
    }

    private boolean handleGet(HttpExchange exchange, String path, Map<String, String> query) throws IOException {
        switch (path) {
            case "/api/stats":
                respond(exchange, 200, Contract.stats(queue.stats()));
                return true;
            case "/api/stats/queues":
                respond(exchange, 200, statsByQueue());
                return true;
            case "/api/queues/paused":
                respond(exchange, 200, queue.listPausedQueues());
                return true;
            case "/api/jobs":
                respond(exchange, 200, listJobs(query));
                return true;
            case "/api/dead-letters":
                respond(exchange, 200, listDead(query));
                return true;
            case "/api/metrics":
                respond(exchange, 200, listMetrics(query));
                return true;
            case "/api/workers":
                respond(exchange, 200, listWorkers());
                return true;
            default:
                return getJob(exchange, path);
        }
    }

    private boolean getJob(HttpExchange exchange, String path) throws IOException {
        Matcher m = JOB.matcher(path);
        if (!m.matches()) {
            return false;
        }
        Optional<Job> job = queue.getJob(m.group(1));
        if (job.isPresent()) {
            respond(exchange, 200, Contract.job(job.get()));
        } else {
            respond(exchange, 404, error("no such job"));
        }
        return true;
    }

    private boolean handlePost(HttpExchange exchange, String path) throws IOException {
        Matcher cancel = CANCEL.matcher(path);
        if (cancel.matches()) {
            respond(exchange, 200, Collections.singletonMap("cancelled", queue.cancel(cancel.group(1))));
            return true;
        }
        Matcher retry = RETRY.matcher(path);
        if (retry.matches()) {
            respond(exchange, 200, Collections.singletonMap("id", queue.retryDead(retry.group(1))));
            return true;
        }
        Matcher pause = PAUSE.matcher(path);
        if (pause.matches()) {
            queue.queue(pause.group(1)).pause();
            respond(exchange, 200, Collections.singletonMap("ok", true));
            return true;
        }
        Matcher resume = RESUME.matcher(path);
        if (resume.matches()) {
            queue.queue(resume.group(1)).resume();
            respond(exchange, 200, Collections.singletonMap("ok", true));
            return true;
        }
        return false;
    }

    private Map<String, Object> statsByQueue() {
        Map<String, Object> out = new LinkedHashMap<>();
        queue.statsAllQueues().forEach((name, stats) -> out.put(name, Contract.stats(stats)));
        return out;
    }

    private List<Map<String, Object>> listJobs(Map<String, String> query) {
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
            filter.limit(Integer.parseInt(query.get("limit")));
        }
        if (query.containsKey("offset")) {
            filter.offset(Integer.parseInt(query.get("offset")));
        }
        return queue.listJobs(filter.build()).stream().map(Contract::job).collect(Collectors.toList());
    }

    private List<Map<String, Object>> listDead(Map<String, String> query) {
        long limit = longParam(query, "limit", DEFAULT_LIMIT);
        long offset = longParam(query, "offset", 0);
        return queue.listDead(limit, offset).stream().map(Contract::dead).collect(Collectors.toList());
    }

    private List<Map<String, Object>> listMetrics(Map<String, String> query) {
        long since = longParam(query, "since", 0);
        return queue.metrics(query.get("task"), since).stream()
                .map(Contract::metric)
                .collect(Collectors.toList());
    }

    private List<Map<String, Object>> listWorkers() {
        return queue.listWorkers().stream().map(Contract::worker).collect(Collectors.toList());
    }

    private void serveStatic(HttpExchange exchange, String path) throws IOException {
        if (staticDir == null) {
            respond(exchange, 404, error("not found"));
            return;
        }
        Path target = staticDir.resolve(path.substring(1)).normalize();
        if (!target.startsWith(staticDir) || !Files.isRegularFile(target)) {
            target = staticDir.resolve("index.html");
        }
        if (!Files.isRegularFile(target)) {
            respond(exchange, 404, error("not found"));
            return;
        }
        byte[] body = Files.readAllBytes(target);
        exchange.getResponseHeaders().set("Content-Type", contentType(target));
        exchange.sendResponseHeaders(200, body.length);
        try (OutputStream out = exchange.getResponseBody()) {
            out.write(body);
        }
    }

    private boolean authorized(HttpExchange exchange, Map<String, String> query) {
        if (token == null) {
            return true;
        }
        if (token.equals(query.get("token"))) {
            exchange.getResponseHeaders().add("Set-Cookie", COOKIE + "=" + token + "; HttpOnly; Path=/");
            return true;
        }
        return token.equals(cookieToken(exchange));
    }

    private static String cookieToken(HttpExchange exchange) {
        List<String> cookies = exchange.getRequestHeaders().getOrDefault("Cookie", Collections.emptyList());
        for (String header : cookies) {
            for (String pair : header.split(";")) {
                String trimmed = pair.trim();
                if (trimmed.startsWith(COOKIE + "=")) {
                    return trimmed.substring(COOKIE.length() + 1);
                }
            }
        }
        return null;
    }

    private static long longParam(Map<String, String> query, String key, long fallback) {
        String value = query.get(key);
        return value == null ? fallback : Long.parseLong(value);
    }

    private static Map<String, String> query(HttpExchange exchange) {
        Map<String, String> out = new HashMap<>();
        String raw = exchange.getRequestURI().getRawQuery();
        if (raw == null) {
            return out;
        }
        for (String pair : raw.split("&")) {
            int eq = pair.indexOf('=');
            if (eq < 0) {
                continue;
            }
            String key = URLDecoder.decode(pair.substring(0, eq), StandardCharsets.UTF_8);
            String value = URLDecoder.decode(pair.substring(eq + 1), StandardCharsets.UTF_8);
            out.put(key, value);
        }
        return out;
    }

    private static Map<String, Object> error(String message) {
        return Collections.singletonMap("error", message);
    }

    private static void respond(HttpExchange exchange, int status, Object body) throws IOException {
        byte[] out;
        try {
            out = JSON.writeValueAsBytes(body);
        } catch (Exception e) {
            throw new SerializationException("failed to encode response", e);
        }
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, out.length);
        try (OutputStream stream = exchange.getResponseBody()) {
            stream.write(out);
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
