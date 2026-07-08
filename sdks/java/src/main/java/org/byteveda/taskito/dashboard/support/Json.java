package org.byteveda.taskito.dashboard.support;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.byteveda.taskito.errors.SerializationException;

/**
 * Shared JSON codec for the dashboard. Output is compact (no spaces) so that
 * records written to the settings KV are byte-compatible with the other SDKs,
 * which persist with the equivalent of {@code json.dumps(separators=(",", ":"))}.
 */
public final class Json {
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() {};

    private Json() {}

    public static byte[] toBytes(Object value) {
        try {
            return MAPPER.writeValueAsBytes(value);
        } catch (IOException e) {
            throw new SerializationException("failed to encode response", e);
        }
    }

    public static String toString(Object value) {
        try {
            return MAPPER.writeValueAsString(value);
        } catch (IOException e) {
            throw new SerializationException("failed to encode value", e);
        }
    }

    /** Parse an object body; returns {@code null} for non-object or malformed input. */
    public static Map<String, Object> readObject(byte[] body) {
        if (body == null || body.length == 0) {
            return null;
        }
        try {
            return asMap(MAPPER.readTree(body));
        } catch (IOException e) {
            return null;
        }
    }

    /** Parse a stored JSON string into a mutable map; {@code null} if malformed/non-object. */
    public static Map<String, Object> parseMap(String json) {
        if (json == null || json.isEmpty()) {
            return null;
        }
        try {
            return asMap(MAPPER.readTree(json));
        } catch (IOException e) {
            return null;
        }
    }

    /** Parse a JSON array of strings; empty list if malformed/non-array/null. */
    public static List<String> parseStringList(String json) {
        if (json == null || json.isEmpty()) {
            return List.of();
        }
        try {
            JsonNode node = MAPPER.readTree(json);
            if (node == null || !node.isArray()) {
                return List.of();
            }
            List<String> out = new ArrayList<>(node.size());
            node.forEach(element -> out.add(element.asText()));
            return out;
        } catch (IOException e) {
            return List.of();
        }
    }

    /** Parse a JSON array of objects into maps; empty list if malformed/non-array/null. */
    public static List<Map<String, Object>> parseListOfObjects(String json) {
        if (json == null || json.isEmpty()) {
            return List.of();
        }
        try {
            JsonNode node = MAPPER.readTree(json);
            if (node == null || !node.isArray()) {
                return List.of();
            }
            List<Map<String, Object>> out = new ArrayList<>(node.size());
            for (JsonNode element : node) {
                Map<String, Object> map = asMap(element);
                if (map != null) {
                    out.add(map);
                }
            }
            return out;
        } catch (IOException e) {
            return List.of();
        }
    }

    private static Map<String, Object> asMap(JsonNode node) {
        if (node == null || !node.isObject()) {
            return null;
        }
        return MAPPER.convertValue(node, MAP_TYPE);
    }
}
