package org.byteveda.taskito.serialization;

import java.lang.reflect.Type;

/** Converts task payloads and results to and from the opaque bytes the core stores. */
public interface Serializer {
    byte[] serialize(Object value);

    <T> T deserialize(byte[] bytes, Class<T> type);

    /**
     * Deserialize to a possibly-generic {@link Type} (from a
     * {@code TypeReference}). The default handles plain {@code Class} types and
     * rejects generic ones; a generics-aware serializer (e.g. {@link JsonSerializer})
     * overrides this.
     */
    default Object deserialize(byte[] bytes, Type type) {
        if (type instanceof Class) {
            return deserialize(bytes, (Class<?>) type);
        }
        throw new UnsupportedOperationException(getClass().getSimpleName()
                + " does not support the generic payload type " + type
                + "; use a Jackson-based serializer or a non-generic Task payload type");
    }
}
