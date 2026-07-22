package org.byteveda.taskito.worker;

import java.lang.reflect.Type;
import java.util.List;
import java.util.function.Predicate;
import org.byteveda.taskito.task.TaskFunction;

/**
 * A worker-registered handler: payload type, the function to run, any payload
 * codecs, and the predicate classifying its failures as retryable ({@code null}
 * retries every exception).
 */
final class RegisteredTask {
    final Type payloadType;
    final TaskFunction<Object, Object> handler;
    final List<String> codecs;
    final Predicate<Throwable> retryOn;

    RegisteredTask(
            Type payloadType, TaskFunction<Object, Object> handler, List<String> codecs, Predicate<Throwable> retryOn) {
        this.payloadType = payloadType;
        this.handler = handler;
        this.codecs = codecs;
        this.retryOn = retryOn;
    }
}
