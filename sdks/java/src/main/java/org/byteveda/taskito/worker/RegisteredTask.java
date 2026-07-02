package org.byteveda.taskito.worker;

import java.lang.reflect.Type;
import java.util.List;
import org.byteveda.taskito.task.TaskFunction;

/** A worker-registered handler: payload type, the function to run, and any payload codecs. */
final class RegisteredTask {
    final Type payloadType;
    final TaskFunction<Object, Object> handler;
    final List<String> codecs;

    RegisteredTask(Type payloadType, TaskFunction<Object, Object> handler, List<String> codecs) {
        this.payloadType = payloadType;
        this.handler = handler;
        this.codecs = codecs;
    }
}
