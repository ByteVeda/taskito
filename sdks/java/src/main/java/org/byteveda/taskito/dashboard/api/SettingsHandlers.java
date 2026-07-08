package org.byteveda.taskito.dashboard.api;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.byteveda.taskito.dashboard.store.SettingsAccess;
import org.byteveda.taskito.dashboard.support.DashboardError;
import org.byteveda.taskito.dashboard.support.Json;

/**
 * Generic settings KV API. Keys under the reserved prefixes ({@code auth:},
 * {@code webhooks:}) are treated as absent everywhere — never listed, read,
 * written, or deleted through this surface — so auth and webhook state cannot be
 * exposed or clobbered. Keys are capped at 256 chars, values at 64 KiB.
 */
public final class SettingsHandlers {
    static final int MAX_KEY_LENGTH = 256;
    static final int MAX_VALUE_LENGTH = 64 * 1024;
    // Hide auth state and the webhook store (persisted under the "taskito.webhooks" key).
    private static final List<String> PROTECTED_PREFIXES = List.of("auth:", "webhooks:", "taskito.webhooks");

    private final SettingsAccess settings;

    public SettingsHandlers(SettingsAccess settings) {
        this.settings = settings;
    }

    public Object list() {
        Map<String, Object> out = new LinkedHashMap<>();
        settings.listSettings().forEach((key, value) -> {
            if (!isProtected(key)) {
                out.put(key, value);
            }
        });
        return out;
    }

    public Object get(String key) {
        if (isProtected(key)) {
            return null; // read as absent → 404
        }
        return settings.getSetting(key).map(value -> entry(key, value)).orElse(null);
    }

    public Object put(String key, Map<String, Object> body) {
        validateKey(key);
        Object raw = body.get("value");
        String value = raw instanceof String s ? s : Json.toString(raw);
        if (value.getBytes(java.nio.charset.StandardCharsets.UTF_8).length > MAX_VALUE_LENGTH) {
            throw DashboardError.badRequest("value too large");
        }
        settings.setSetting(key, value);
        return entry(key, value);
    }

    public Object delete(String key) {
        if (isProtected(key)) {
            throw DashboardError.notFound("not found");
        }
        return Map.of("deleted", settings.deleteSetting(key));
    }

    private static Map<String, Object> entry(String key, String value) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("key", key);
        m.put("value", value);
        return m;
    }

    private static boolean isProtected(String key) {
        return PROTECTED_PREFIXES.stream().anyMatch(key::startsWith);
    }

    private static void validateKey(String key) {
        if (key == null || key.isEmpty() || key.length() > MAX_KEY_LENGTH) {
            throw DashboardError.badRequest("invalid setting key");
        }
        for (int i = 0; i < key.length(); i++) {
            char c = key.charAt(i);
            if (c < 32 || c == 127) {
                throw DashboardError.badRequest("invalid setting key");
            }
        }
        if (isProtected(key)) {
            throw DashboardError.badRequest("setting key is reserved");
        }
    }
}
