package org.byteveda.taskito.dashboard.api;

import org.byteveda.taskito.Taskito;

/**
 * Echoes the retention windows the elected cleaner published for this
 * namespace, so the dashboard can explain why rows disappear from its
 * listings. Retention runs in the worker process, so this is never computed
 * from local config — an unreported policy is reported as such.
 */
public final class RetentionHandlers {

    private final Taskito queue;

    public RetentionHandlers(Taskito queue) {
        this.queue = queue;
    }

    /** The published retention policy for this queue's namespace. */
    public Object retention() {
        return Contract.retention(queue.effectiveRetention().orElse(null));
    }

    /** Preview what a purge would delete under the default windows, computed
     *  in-process — so it always answers, never the unreported state. */
    public Object retentionDryRun() {
        return Contract.retentionDryRun(queue.dryRunRetention());
    }
}
