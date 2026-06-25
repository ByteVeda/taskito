package org.byteveda.taskito.serialization;

import java.security.MessageDigest;
import java.util.Arrays;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.byteveda.taskito.TaskitoException;

/**
 * Wraps a delegate serializer, prefixing each payload with an HMAC-SHA256 tag.
 * Deserialization verifies the tag (constant-time) and rejects tampered bytes.
 */
public final class SignedSerializer implements Serializer {
    private static final String ALGORITHM = "HmacSHA256";
    private static final int MAC_LENGTH = 32;

    private final Serializer delegate;
    private final byte[] key;

    public SignedSerializer(Serializer delegate, byte[] key) {
        this.delegate = delegate;
        this.key = key.clone();
    }

    @Override
    public byte[] serialize(Object value) {
        byte[] body = delegate.serialize(value);
        byte[] mac = mac(body);
        byte[] out = new byte[MAC_LENGTH + body.length];
        System.arraycopy(mac, 0, out, 0, MAC_LENGTH);
        System.arraycopy(body, 0, out, MAC_LENGTH, body.length);
        return out;
    }

    @Override
    public <T> T deserialize(byte[] bytes, Class<T> type) {
        if (bytes.length < MAC_LENGTH) {
            throw new TaskitoException("signed payload is too short");
        }
        byte[] mac = Arrays.copyOfRange(bytes, 0, MAC_LENGTH);
        byte[] body = Arrays.copyOfRange(bytes, MAC_LENGTH, bytes.length);
        if (!MessageDigest.isEqual(mac, mac(body))) {
            throw new TaskitoException("signature mismatch");
        }
        return delegate.deserialize(body, type);
    }

    private byte[] mac(byte[] body) {
        try {
            Mac mac = Mac.getInstance(ALGORITHM);
            mac.init(new SecretKeySpec(key, ALGORITHM));
            return mac.doFinal(body);
        } catch (Exception e) {
            throw new TaskitoException("HMAC computation failed", e);
        }
    }
}
