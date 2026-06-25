package org.byteveda.taskito.webhooks;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.byteveda.taskito.TaskitoException;

/** Delivers webhook payloads over HTTP with an optional HMAC signature and retries. */
final class Deliverer {
    private static final String ALGORITHM = "HmacSHA256";
    private static final char[] HEX = "0123456789abcdef".toCharArray();

    private final HttpClient client = HttpClient.newHttpClient();

    /** Send {@code body} to the hook (non-blocking). Retries server errors. */
    void deliver(Webhook hook, byte[] body) {
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(hook.url))
                .timeout(Duration.ofMillis(hook.timeoutMs))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofByteArray(body));
        if (hook.secret != null) {
            request.header("X-Taskito-Signature", "sha256=" + sign(hook.secret, body));
        }
        hook.headers.forEach(request::header);
        sendWithRetry(request.build(), hook.maxRetries);
    }

    private void sendWithRetry(HttpRequest request, int attemptsLeft) {
        client.sendAsync(request, HttpResponse.BodyHandlers.discarding())
                .whenComplete((response, error) -> {
                    boolean failed = error != null || response.statusCode() >= 500;
                    if (failed && attemptsLeft > 0) {
                        sendWithRetry(request, attemptsLeft - 1);
                    }
                });
    }

    static String sign(String secret, byte[] body) {
        try {
            Mac mac = Mac.getInstance(ALGORITHM);
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), ALGORITHM));
            return hex(mac.doFinal(body));
        } catch (Exception e) {
            throw new TaskitoException("webhook signature failed", e);
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
