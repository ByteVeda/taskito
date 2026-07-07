package org.byteveda.taskito.core;

import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.byteveda.taskito.TaskitoException;
import org.byteveda.taskito.errors.ConfigurationException;
import org.byteveda.taskito.errors.CryptoException;
import org.byteveda.taskito.errors.LockException;
import org.byteveda.taskito.errors.SerializationException;
import org.byteveda.taskito.errors.WebhookException;
import org.byteveda.taskito.errors.WorkflowException;
import org.byteveda.taskito.serialization.JsonSerializer;
import org.byteveda.taskito.serialization.Serializer;
import org.byteveda.taskito.serialization.SignedSerializer;
import org.junit.jupiter.api.Test;

class ExceptionHierarchyTest {

    @Test
    void everySpecificExceptionExtendsTheBase() {
        assertTrue(TaskitoException.class.isAssignableFrom(SerializationException.class));
        assertTrue(TaskitoException.class.isAssignableFrom(WorkflowException.class));
        assertTrue(TaskitoException.class.isAssignableFrom(LockException.class));
        assertTrue(TaskitoException.class.isAssignableFrom(ConfigurationException.class));
        assertTrue(TaskitoException.class.isAssignableFrom(WebhookException.class));
        // CryptoException is a kind of SerializationException.
        assertTrue(SerializationException.class.isAssignableFrom(CryptoException.class));
    }

    @Test
    void malformedPayloadThrowsSerializationException() {
        Serializer json = new JsonSerializer();
        assertThrows(SerializationException.class, () -> json.deserialize("not json".getBytes(), Integer.class));
    }

    @Test
    void tamperedSignedPayloadThrowsCryptoException() {
        Serializer signed = new SignedSerializer(new JsonSerializer(), "secret".getBytes());
        byte[] bytes = signed.serialize(42);
        bytes[0] ^= 0x01; // corrupt the HMAC tag

        CryptoException error = assertThrows(CryptoException.class, () -> signed.deserialize(bytes, Integer.class));
        // A caller may catch it as the category or the base type.
        assertInstanceOf(SerializationException.class, error);
        assertInstanceOf(TaskitoException.class, error);
    }
}
