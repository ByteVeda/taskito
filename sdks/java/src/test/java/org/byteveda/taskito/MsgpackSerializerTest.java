package org.byteveda.taskito;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.LinkedHashMap;
import java.util.Map;
import org.byteveda.taskito.serialization.MsgpackSerializer;
import org.byteveda.taskito.serialization.Serializer;
import org.junit.jupiter.api.Test;

class MsgpackSerializerTest {

    @Test
    void roundTripsScalar() {
        Serializer msgpack = new MsgpackSerializer();
        byte[] bytes = msgpack.serialize(42);
        assertEquals(42, msgpack.deserialize(bytes, Integer.class));
    }

    @Test
    @SuppressWarnings("unchecked")
    void roundTripsMap() {
        Serializer msgpack = new MsgpackSerializer();
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("count", 3);
        value.put("name", "taskito");

        byte[] bytes = msgpack.serialize(value);
        Map<String, Object> back = msgpack.deserialize(bytes, Map.class);

        assertEquals(3, ((Number) back.get("count")).intValue());
        assertEquals("taskito", back.get("name"));
    }
}
