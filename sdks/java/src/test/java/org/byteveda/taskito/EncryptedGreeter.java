package org.byteveda.taskito;

import org.byteveda.taskito.annotation.Encrypted;
import org.byteveda.taskito.annotation.TaskHandler;

/** Test fixture: an @Encrypted handler; the generated task carries the "encrypted" codec. */
class EncryptedGreeter {

    @TaskHandler("eg.greet")
    @Encrypted
    String greet(String name) {
        return "secret " + name;
    }
}
