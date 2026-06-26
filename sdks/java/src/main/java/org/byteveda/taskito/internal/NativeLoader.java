package org.byteveda.taskito.internal;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.FileAlreadyExistsException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.UUID;

/**
 * Loads the native Taskito library.
 *
 * <p>Order: an explicit {@code -Dtaskito.native.lib=/path} override, otherwise
 * the platform binary bundled in the JAR is extracted and loaded. Extraction is
 * content-addressed — the target file name embeds a hash of the bytes — so it is
 * safe under concurrent processes (atomic move), avoids re-extraction across
 * runs, and never loads a stale binary from a previous build. Honor
 * {@code -Dtaskito.native.workdir} for hardened/noexec {@code /tmp} environments.
 */
public final class NativeLoader {
    private static final String LIB = "taskito_java";
    private static final String WORKDIR_PROPERTY = "taskito.native.workdir";
    private static boolean loaded;

    private NativeLoader() {}

    /** Load the library once per process. */
    public static synchronized void load() {
        if (loaded) {
            return;
        }
        String override = System.getProperty("taskito.native.lib");
        System.load(override != null ? override : extractBundled());
        loaded = true;
    }

    private static String extractBundled() {
        byte[] bytes = readResource();
        try {
            Path dir = workdir();
            Files.createDirectories(dir);
            Path target = dir.resolve(platformDir() + "-" + hash(bytes) + "-" + System.mapLibraryName(LIB));
            if (!Files.isRegularFile(target) || Files.size(target) != bytes.length) {
                materialize(dir, target, bytes);
            }
            return target.toAbsolutePath().toString();
        } catch (IOException e) {
            throw new UnsatisfiedLinkError("failed to extract native library: " + e.getMessage());
        }
    }

    /** Write to a unique temp file, then atomically move it into place. */
    private static void materialize(Path dir, Path target, byte[] bytes) throws IOException {
        Path temp = dir.resolve(".tmp-" + UUID.randomUUID());
        Files.write(temp, bytes);
        try {
            Files.move(temp, target, StandardCopyOption.ATOMIC_MOVE);
        } catch (FileAlreadyExistsException raced) {
            Files.deleteIfExists(temp); // another process won the race — its file is identical
        } catch (AtomicMoveNotSupportedException unsupported) {
            Files.move(temp, target, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    private static byte[] readResource() {
        String resource = "/org/byteveda/taskito/native/" + platformDir() + "/" + System.mapLibraryName(LIB);
        try (InputStream in = NativeLoader.class.getResourceAsStream(resource)) {
            if (in == null) {
                throw new UnsatisfiedLinkError("no bundled native library for platform '" + platformDir() + "' ("
                        + resource + "); set -Dtaskito.native.lib=/path/to/library");
            }
            return in.readAllBytes();
        } catch (IOException e) {
            throw new UnsatisfiedLinkError("failed to read native library: " + e.getMessage());
        }
    }

    private static Path workdir() {
        String configured = System.getProperty(WORKDIR_PROPERTY);
        String base = configured != null ? configured : System.getProperty("java.io.tmpdir");
        return Paths.get(base).resolve("taskito-native");
    }

    private static String hash(byte[] bytes) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(bytes);
            StringBuilder hex = new StringBuilder(16);
            for (int i = 0; i < 8; i++) {
                hex.append(Character.forDigit((digest[i] >> 4) & 0xf, 16));
                hex.append(Character.forDigit(digest[i] & 0xf, 16));
            }
            return hex.toString();
        } catch (Exception e) {
            throw new UnsatisfiedLinkError("hashing failed: " + e.getMessage());
        }
    }

    /** Resource classifier directory, e.g. {@code linux-x86_64}. */
    static String platformDir() {
        String os = System.getProperty("os.name", "").toLowerCase(Locale.ROOT);
        String arch = System.getProperty("os.arch", "").toLowerCase(Locale.ROOT);
        String osDir = os.contains("win") ? "windows" : (os.contains("mac") || os.contains("darwin")) ? "osx" : "linux";
        String archDir = (arch.equals("amd64") || arch.equals("x86_64"))
                ? "x86_64"
                : (arch.equals("aarch64") || arch.equals("arm64")) ? "aarch64" : arch;
        return osDir + "-" + archDir;
    }
}
