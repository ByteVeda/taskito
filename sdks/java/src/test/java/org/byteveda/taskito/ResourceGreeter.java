package org.byteveda.taskito;

import org.byteveda.taskito.annotation.Resource;
import org.byteveda.taskito.annotation.TaskHandler;

/** Test fixture: a handler with a {@code @Resource}-injected parameter after the payload. */
class ResourceGreeter {

    @TaskHandler("rg.greet")
    String greet(String name, @Resource("salutation") String salutation) {
        return salutation + " " + name;
    }
}
