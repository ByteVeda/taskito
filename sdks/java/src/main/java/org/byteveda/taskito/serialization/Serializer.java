package org.byteveda.taskito.serialization;

/** Converts task payloads and results to and from the opaque bytes the core stores. */
public interface Serializer {
    byte[] serialize(Object value);

    <T> T deserialize(byte[] bytes, Class<T> type);
}
