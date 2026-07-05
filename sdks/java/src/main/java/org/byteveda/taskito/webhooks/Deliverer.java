package org.byteveda.taskito.webhooks;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.byteveda.taskito.errors.WebhookException;
import org.byteveda.taskito.logging.TaskitoLogger;

/** Delivers webhook payloads over HTTP with an optional HMAC signature and retries. */
final class Deliverer {
    private static final TaskitoLogger LOG = TaskitoLogger.create("webhooks");
    private static final String ALGORITHM = "HmacSHA256";
    private static final char[] HEX = "0123456789abcdef".toCharArray();
    // Exponential backoff matching the Node SDK: 500ms, 1s, 2s, ... capped at 30s.
    private static final long BASE_BACKOFF_MS = 500;
    private static final long MAX_BACKOFF_MS = 30_000;
    // 500ms << 6 = 32s > cap, so larger shifts can never change the delay.
    private static final int MAX_BACKOFF_SHIFT = 6;

    private final HttpClient client = HttpClient.newHttpClient();

    /** Send {@code body} to the hook (non-blocking). Retries server errors with backoff. */
    void deliver(Webhook hook, byte[] body) {
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(hook.url))
                .timeout(Duration.ofMillis(hook.timeoutMs))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofByteArray(body));
        if (hook.secret != null) {
            request.header("X-Taskito-Signature", "sha256=" + sign(hook.secret, body));
        }
        hook.headers.forEach(request::header);
        sendWithRetry(request.build(), 0, hook.maxRetries);
    }

    private void sendWithRetry(HttpRequest request, int attempt, int maxRetries) {
        client.sendAsync(request, HttpResponse.BodyHandlers.discarding()).whenComplete((response, error) -> {
            boolean failed = error != null || response.statusCode() >= 500;
            if (!failed) {
                return;
            }
            if (attempt >= maxRetries) {
                LOG.warn("webhook delivery to " + redact(request.uri()) + " failed after " + (attempt + 1)
                        + " attempt(s)" + (error != null ? ": " + error : ": HTTP " + response.statusCode()));
                return;
            }
            // Clamp the exponent before shifting: an unbounded shift overflows and
            // would schedule negative delays for very large maxRetries.
            long delayMs = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS << Math.min(attempt, MAX_BACKOFF_SHIFT));
            CompletableFuture.delayedExecutor(delayMs, TimeUnit.MILLISECONDS)
                    .execute(() -> sendWithRetry(request, attempt + 1, maxRetries));
        });
    }

    /** Origin only (scheme://host:port) — path segments and queries can carry tokens. */
    private static String redact(URI uri) {
        try {
            return new URI(uri.getScheme(), null, uri.getHost(), uri.getPort(), null, null, null).toString();
        } catch (Exception e) {
            return "<invalid-url>";
        }
    }

    static String sign(String secret, byte[] body) {
        try {
            Mac mac = Mac.getInstance(ALGORITHM);
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), ALGORITHM));
            return hex(mac.doFinal(body));
        } catch (Exception e) {
            throw new WebhookException("webhook signature failed", e);
        }
    }

    private static String hex(byte[] bytes) {
        char[] out = new char[bytes.length * 2];
        for (int i = 0; i < bytes.length; i++) {
            int b = bytes[i] & 0xff;
            out[i * 2] = HEX[b >>> 4];
            out[i * 2 + 1] = HEX[b & 0x0f];
        }
        return new String(out);
    }
}
