package org.byteveda.taskito.internal;

import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class NativeLoaderTest {

    @Test
    void platformDirIsClassifierShaped() {
        String dir = NativeLoader.platformDir();
        assertTrue(dir.matches("(linux|osx|windows)-\\S+"), "unexpected classifier: " + dir);
    }
}
