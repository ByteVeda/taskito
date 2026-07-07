package org.byteveda.taskito.dashboard.routing;

import java.io.IOException;

/**
 * A route handler. Returns the JSON response body (serialised with status 200),
 * or {@code null} to signal 404. Throw {@code DashboardError} for other
 * statuses. May add {@code Set-Cookie} response headers before returning.
 */
@FunctionalInterface
public interface Handler {
    Object handle(Req req) throws IOException;
}
