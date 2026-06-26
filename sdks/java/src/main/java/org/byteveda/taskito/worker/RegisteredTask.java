package org.byteveda.taskito.worker;

import org.byteveda.taskito.task.TaskFunction;

/** A worker-registered handler: payload type plus the function to run. */
final class RegisteredTask {
    final Class<?> payloadType;
    final TaskFunction<Object, Object> handler;

    RegisteredTask(Class<?> payloadType, TaskFunction<Object, Object> handler) {
        this.payloadType = payloadType;
        this.handler = handler;
    }
}
