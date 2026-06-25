package org.byteveda.taskito.internal;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Locale;

/**
 * Loads the native Taskito library.
 *
 * <p>Order: an explicit {@code -Dtaskito.native.lib=/path} override, otherwise
 * the platform binary bundled in the JAR is extracted to a temp file and loaded.
 */
public final class NativeLoader {
    private static final String LIB = "taskito_java";
    private static boolean loaded;

    private NativeLoader() {}

    /** Load the library once per process. */
    public static synchronized void load() {
        if (loaded) {
            return;
        }
        String override = System.getProperty("taskito.native.lib");
        if (override != null) {
            System.load(override);
        } else {
            System.load(extractBundled());
        }
        loaded = true;
    }

    /** Extract the bundled platform binary to a temp file; return its path. */
    private static String extractBundled() {
        String resource = "/org/byteveda/taskito/native/" + platformDir() + "/" + System.mapLibraryName(LIB);
        InputStream in = NativeLoader.class.getResourceAsStream(resource);
        if (in == null) {
            throw new UnsatisfiedLinkError(
                "no bundled native library for platform '" + platformDir() + "' (" + resource
                    + "); set -Dtaskito.native.lib=/path/to/library");
        }
        try {
            Path dir = Files.createTempDirectory("taskito-native");
            dir.toFile().deleteOnExit();
            Path target = dir.resolve(System.mapLibraryName(LIB));
            try (InputStream src = in; OutputStream out = Files.newOutputStream(target)) {
                byte[] buf = new byte[8192];
                int n;
                while ((n = src.read(buf)) != -1) {
                    out.write(buf, 0, n);
                }
            }
            target.toFile().deleteOnExit();
            return target.toAbsolutePath().toString();
        } catch (IOException e) {
            throw new UnsatisfiedLinkError("failed to extract native library: " + e.getMessage());
        }
    }

    /** Resource classifier directory, e.g. {@code linux-x86_64}. */
    static String platformDir() {
        String os = System.getProperty("os.name", "").toLowerCase(Locale.ROOT);
        String arch = System.getProperty("os.arch", "").toLowerCase(Locale.ROOT);
        String osDir = os.contains("win") ? "windows"
            : (os.contains("mac") || os.contains("darwin")) ? "osx"
            : "linux";
        String archDir = (arch.equals("amd64") || arch.equals("x86_64")) ? "x86_64"
            : (arch.equals("aarch64") || arch.equals("arm64")) ? "aarch64"
            : arch;
        return osDir + "-" + archDir;
    }
}
