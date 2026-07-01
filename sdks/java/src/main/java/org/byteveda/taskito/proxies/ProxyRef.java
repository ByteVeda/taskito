package org.byteveda.taskito.proxies;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.Map;

/**
 * A serializable, signed reference to a non-serializable resource. Carry it in a
 * job payload; the worker reconstructs the resource with
 * {@link Proxies#reconstruct}.
 *
 * @param handler the {@link ProxyHandler#id()} that produced (and reconstructs) it
 * @param reference the handler's serializable reference data
 * @param signature an HMAC over {@code handler + reference}, verified on reconstruct
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record ProxyRef(String handler, Map<String, Object> reference, String signature) {}
