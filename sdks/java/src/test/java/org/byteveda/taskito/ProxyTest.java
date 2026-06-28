package org.byteveda.taskito;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.File;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.byteveda.taskito.errors.ProxyException;
import org.byteveda.taskito.proxies.FileProxyHandler;
import org.byteveda.taskito.proxies.Proxies;
import org.byteveda.taskito.proxies.ProxyRef;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ProxyTest {

    private static final byte[] KEY = "proxy-secret-key".getBytes();
    private final ObjectMapper json = new ObjectMapper();

    @Test
    void roundTripsFileAcrossTheWire(@TempDir Path dir) throws Exception {
        Proxies proxies = new Proxies(KEY).register(new FileProxyHandler());
        File file = dir.resolve("data.txt").toFile();

        ProxyRef ref = proxies.deconstruct(file);
        ProxyRef onWire = json.readValue(json.writeValueAsBytes(ref), ProxyRef.class); // simulate serialization
        File reconstructed = proxies.resolve(onWire);

        assertEquals(file.getAbsolutePath(), reconstructed.getAbsolutePath());
    }

    @Test
    void rejectsTamperedRef(@TempDir Path dir) {
        Proxies proxies = new Proxies(KEY).register(new FileProxyHandler());
        ProxyRef ref = proxies.deconstruct(dir.resolve("a").toFile());
        ProxyRef tampered = new ProxyRef(ref.handler(), Map.of("path", "/etc/passwd"), ref.signature());

        assertThrows(ProxyException.class, () -> proxies.reconstruct(tampered));
    }

    @Test
    void enforcesAllowlist(@TempDir Path dir) {
        Proxies proxies = new Proxies(KEY).register(new FileProxyHandler(List.of(dir)));

        File inside = dir.resolve("ok.txt").toFile();
        File back = proxies.resolve(proxies.deconstruct(inside));
        assertEquals(inside.getAbsolutePath(), back.getAbsolutePath());

        File outside = dir.getParent().resolve("outside.txt").toFile();
        ProxyRef ref = proxies.deconstruct(outside);
        assertThrows(ProxyException.class, () -> proxies.reconstruct(ref));
    }

    @Test
    void rejectsValueWithNoHandler() {
        Proxies proxies = new Proxies(KEY);
        assertThrows(ProxyException.class, () -> proxies.deconstruct("not proxyable"));
    }

    @Test
    void rejectsUnknownHandlerOnReconstruct() {
        Proxies proxies = new Proxies(KEY).register(new FileProxyHandler());
        assertThrows(ProxyException.class, () -> proxies.reconstruct(new ProxyRef("nope", Map.of(), "sig")));
    }
}
