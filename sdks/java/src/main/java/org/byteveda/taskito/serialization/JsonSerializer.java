package org.byteveda.taskito.serialization;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.byteveda.taskito.TaskitoException;

/** Default {@link Serializer}: JSON via Jackson. */
public final class JsonSerializer implements Serializer {
    private final ObjectMapper mapper;

    public JsonSerializer() {
        this(new ObjectMapper());
    }

    public JsonSerializer(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    @Override
    public byte[] serialize(Object value) {
        try {
            return mapper.writeValueAsBytes(value);
        } catch (Exception e) {
            throw new TaskitoException("failed to serialize payload", e);
        }
    }

    @Override
    public <T> T deserialize(byte[] bytes, Class<T> type) {
        try {
            return mapper.readValue(bytes, type);
        } catch (Exception e) {
            throw new TaskitoException("failed to deserialize payload", e);
        }
    }
}
