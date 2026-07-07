package org.byteveda.taskito.dashboard.store;

import java.util.Map;
import java.util.Optional;
import org.byteveda.taskito.Taskito;

/**
 * Narrow view of the {@code dashboard_settings} KV store — the single
 * persistence primitive behind auth, OAuth state, overrides, middleware toggles
 * and webhooks. Every backend already exposes it, so no schema changes are
 * needed. Decoupling the stores from {@link Taskito} keeps them unit-testable
 * against an in-memory map.
 */
public interface SettingsAccess {

    Optional<String> getSetting(String key);

    void setSetting(String key, String value);

    /** @return whether a row existed. */
    boolean deleteSetting(String key);

    /** All settings; callers filter by key prefix. */
    Map<String, String> listSettings();

    static SettingsAccess of(Taskito queue) {
        return new SettingsAccess() {
            @Override
            public Optional<String> getSetting(String key) {
                return queue.getSetting(key);
            }

            @Override
            public void setSetting(String key, String value) {
                queue.setSetting(key, value);
            }

            @Override
            public boolean deleteSetting(String key) {
                return queue.deleteSetting(key);
            }

            @Override
            public Map<String, String> listSettings() {
                return queue.listSettings();
            }
        };
    }
}
