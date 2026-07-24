package org.byteveda.taskito.internal;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.FileAlreadyExistsException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.MessageDigest;
import java.util.Locale;

/**
 * Loads the native Taskito library.
 *
 * <p>Order: an explicit {@code -Dtaskito.native.lib=/path} override, otherwise
 * the platform binary on the classpath (shipped in the matching per-platform
 * classifier jar) is extracted and loaded. Extraction is
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
        String expected = sha256Hex(bytes);
        try {
            Path dir = secureWorkdir();
            Path target =
                    dir.resolve(platformDir() + "-" + expected.substring(0, 16) + "-" + System.mapLibraryName(LIB));
            if (!isTrusted(target, bytes.length, expected)) {
                materialize(dir, target, bytes);
                // Fail closed: never System.load a file we haven't verified
                // byte-for-byte. A racing writer could have left an untrusted file
                // at the target after we dropped ours.
                if (!isTrusted(target, bytes.length, expected)) {
                    throw new IOException("native library failed integrity check at " + target);
                }
            }
            return target.toAbsolutePath().toString();
        } catch (IOException e) {
            throw new UnsatisfiedLinkError("failed to extract native library: " + e.getMessage());
        }
    }

    /**
     * A pre-existing file is reused only if it is a real (non-symlink) regular
     * file of the expected length whose bytes hash to {@code expected}. This
     * rejects a swapped or symlinked file planted in a shared workdir.
     */
    private static boolean isTrusted(Path target, long expectedLength, String expected) throws IOException {
        if (!Files.isRegularFile(target, LinkOption.NOFOLLOW_LINKS) || Files.size(target) != expectedLength) {
            return false;
        }
        return sha256Hex(Files.readAllBytes(target)).equals(expected);
    }

    /** Write to a unique temp file, then atomically move it into place. */
    private static void materialize(Path dir, Path target, byte[] bytes) throws IOException {
        Path temp = Files.createTempFile(dir, ".tmp-", null);
        boolean moved = false;
        try {
            Files.write(temp, bytes);
            // We only reach here after verification failed, so drop any untrusted
            // or symlinked file squatting the target. NOFOLLOW deletes the link
            // itself, not whatever it points at.
            Files.deleteIfExists(target);
            try {
                Files.move(temp, target, StandardCopyOption.ATOMIC_MOVE);
                moved = true;
            } catch (FileAlreadyExistsException raced) {
                moved = false; // another process won; the caller re-verifies the target
            } catch (AtomicMoveNotSupportedException unsupported) {
                Files.move(temp, target, StandardCopyOption.REPLACE_EXISTING);
                moved = true;
            }
        } finally {
            if (!moved) {
                Files.deleteIfExists(temp); // don't leave .tmp-* behind on failure or loss
            }
        }
    }

    private static byte[] readResource() {
        String resource = "/org/byteveda/taskito/native/" + platformDir() + "/" + System.mapLibraryName(LIB);
        try (InputStream in = NativeLoader.class.getResourceAsStream(resource)) {
            if (in == null) {
                throw new UnsatisfiedLinkError("no native library for platform '" + platformDir() + "' on the"
                        + " classpath (" + resource + "); add the classifier artifact"
                        + " org.byteveda:taskito:<version>:" + platformDir()
                        + " as a runtime dependency, or set -Dtaskito.native.lib=/path/to/library");
            }
            return in.readAllBytes();
        } catch (IOException e) {
            throw new UnsatisfiedLinkError("failed to read native library: " + e.getMessage());
        }
    }

    /**
     * Per-user extraction directory with owner-only permissions, so other users
     * on a shared {@code /tmp} can't pre-create or swap the file we load.
     */
    private static Path secureWorkdir() throws IOException {
        String configured = System.getProperty(WORKDIR_PROPERTY);
        String base = configured != null ? configured : System.getProperty("java.io.tmpdir");
        Path dir = Paths.get(base).resolve("taskito-native-" + System.getProperty("user.name", "anon"));
        Files.createDirectories(dir);
        try {
            Files.setPosixFilePermissions(dir, PosixFilePermissions.fromString("rwx------"));
        } catch (UnsupportedOperationException nonPosix) {
            // Windows etc.: per-user profile dirs are already ACL-restricted.
        }
        return dir;
    }

    private static String sha256Hex(byte[] bytes) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(bytes);
            StringBuilder hex = new StringBuilder(digest.length * 2);
            for (byte b : digest) {
                hex.append(Character.forDigit((b >> 4) & 0xf, 16));
                hex.append(Character.forDigit(b & 0xf, 16));
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
