package org.byteveda.taskito.proxies;

import java.io.File;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.byteveda.taskito.errors.ProxyException;

/**
 * Proxies a {@link File} by its absolute path. An optional allowlist of root
 * directories is enforced on reconstruct, so a tampered or hostile ref cannot
 * resolve to a path outside them (an empty allowlist permits any path).
 */
public final class FileProxyHandler implements ProxyHandler<File> {
    private final List<Path> allowedRoots;

    public FileProxyHandler() {
        this(List.of());
    }

    public FileProxyHandler(List<Path> allowedRoots) {
        List<Path> roots = new ArrayList<>(allowedRoots.size());
        for (Path root : allowedRoots) {
            roots.add(root.toAbsolutePath().normalize());
        }
        this.allowedRoots = List.copyOf(roots);
    }

    @Override
    public String id() {
        return "file";
    }

    @Override
    public boolean handles(Object value) {
        return value instanceof File;
    }

    @Override
    public Map<String, Object> deconstruct(File value) {
        return Map.of("path", value.getAbsolutePath());
    }

    @Override
    public File reconstruct(Map<String, Object> reference) {
        Object path = reference.get("path");
        if (!(path instanceof String)) {
            throw new ProxyException("file proxy ref missing 'path'");
        }
        Path resolved = Paths.get((String) path).toAbsolutePath().normalize();
        if (!allowed(resolved)) {
            throw new ProxyException("file path not in allowlist: " + resolved);
        }
        return resolved.toFile();
    }

    private boolean allowed(Path path) {
        if (allowedRoots.isEmpty()) {
            return true;
        }
        for (Path root : allowedRoots) {
            if (path.startsWith(root)) {
                return true;
            }
        }
        return false;
    }
}
