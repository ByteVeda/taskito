package org.byteveda.taskito.worker;

import java.lang.reflect.Type;
import org.byteveda.taskito.task.TaskFunction;

/** A worker-registered handler: payload type plus the function to run. */
final class RegisteredTask {
    final Type payloadType;
    final TaskFunction<Object, Object> handler;

    RegisteredTask(Type payloadType, TaskFunction<Object, Object> handler) {
        this.payloadType = payloadType;
        this.handler = handler;
    }
}
