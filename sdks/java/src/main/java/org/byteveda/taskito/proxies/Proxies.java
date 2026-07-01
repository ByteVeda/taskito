package org.byteveda.taskito.proxies;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.byteveda.taskito.errors.ProxyException;

/**
 * Registry that deconstructs resources into signed {@link ProxyRef}s and
 * reconstructs them. Construct with an HMAC key (shared by producer and worker),
 * register a {@link ProxyHandler} per resource type, then
 * {@link #deconstruct(Object)} on the producer and {@link #reconstruct(ProxyRef)}
 * (or {@link #resolve(ProxyRef)}) on the worker.
 */
public final class Proxies {
    private static final String ALGORITHM = "HmacSHA256";

    private final Map<String, ProxyHandler<?>> handlers = new LinkedHashMap<>();
    private final byte[] key;
    private final ObjectMapper canonical =
            new ObjectMapper().configure(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS, true);

    public Proxies(byte[] hmacKey) {
        this.key = hmacKey.clone();
    }

    /** Register a handler under its non-null, unique id; returns {@code this}. */
    public Proxies register(ProxyHandler<?> handler) {
        String id = handler.id();
        if (id == null) {
            throw new ProxyException("proxy handler id must not be null");
        }
        // Fail fast on a duplicate: silently overwriting would let a producer and
        // worker disagree on what a given ProxyRef's handler id means.
        if (handlers.putIfAbsent(id, handler) != null) {
            throw new ProxyException("proxy handler '" + id + "' is already registered");
        }
        return this;
    }

    /** Deconstruct {@code value} into a signed ref; throws if no handler accepts it. */
    @SuppressWarnings("unchecked")
    public ProxyRef deconstruct(Object value) {
        for (ProxyHandler<?> handler : handlers.values()) {
            if (handler.handles(value)) {
                Map<String, Object> reference = ((ProxyHandler<Object>) handler).deconstruct(value);
                return new ProxyRef(handler.id(), reference, sign(handler.id(), reference));
            }
        }
        throw new ProxyException("no proxy handler for " + value.getClass().getName());
    }

    /** Verify a ref's signature and reconstruct the resource. */
    @SuppressWarnings("unchecked")
    public Object reconstruct(ProxyRef ref) {
        ProxyHandler<Object> handler = (ProxyHandler<Object>) handlers.get(ref.handler());
        if (handler == null) {
            throw new ProxyException("unknown proxy handler '" + ref.handler() + "'");
        }
        byte[] expected = sign(ref.handler(), ref.reference()).getBytes(StandardCharsets.UTF_8);
        byte[] actual = (ref.signature() == null ? "" : ref.signature()).getBytes(StandardCharsets.UTF_8);
        if (!MessageDigest.isEqual(expected, actual)) {
            throw new ProxyException("proxy signature mismatch for handler '" + ref.handler() + "'");
        }
        return handler.reconstruct(ref.reference());
    }

    /** {@link #reconstruct(ProxyRef)} cast to the caller's type. */
    @SuppressWarnings("unchecked")
    public <T> T resolve(ProxyRef ref) {
        return (T) reconstruct(ref);
    }

    private String sign(String handlerId, Map<String, Object> reference) {
        try {
            Mac mac = Mac.getInstance(ALGORITHM);
            mac.init(new SecretKeySpec(key, ALGORITHM));
            mac.update(handlerId.getBytes(StandardCharsets.UTF_8));
            mac.update((byte) '\n');
            mac.update(canonical.writeValueAsBytes(reference));
            return Base64.getEncoder().encodeToString(mac.doFinal());
        } catch (Exception e) {
            throw new ProxyException("failed to sign proxy ref", e);
        }
    }
}
