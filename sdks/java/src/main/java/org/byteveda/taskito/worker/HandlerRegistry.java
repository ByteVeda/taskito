package org.byteveda.taskito.worker;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/**
 * An immutable bundle of {@link Handler}s registered together via
 * {@code Worker.Builder.register}. Generated {@code <Class>Tasks.handlers(impl)}
 * returns one of these.
 */
public final class HandlerRegistry {
    private final List<Handler<?, ?>> handlers;

    private HandlerRegistry(List<Handler<?, ?>> handlers) {
        this.handlers = handlers;
    }

    public static HandlerRegistry of(Handler<?, ?>... handlers) {
        return new HandlerRegistry(Collections.unmodifiableList(Arrays.asList(handlers)));
    }

    public List<Handler<?, ?>> handlers() {
        return handlers;
    }
}
