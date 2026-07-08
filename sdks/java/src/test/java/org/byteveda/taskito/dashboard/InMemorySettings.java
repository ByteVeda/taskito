package org.byteveda.taskito.dashboard;

import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import org.byteveda.taskito.dashboard.store.SettingsAccess;

/** In-memory {@link SettingsAccess} for unit tests. */
public final class InMemorySettings implements SettingsAccess {
    private final Map<String, String> map = new HashMap<>();

    @Override
    public Optional<String> getSetting(String key) {
        return Optional.ofNullable(map.get(key));
    }

    @Override
    public void setSetting(String key, String value) {
        map.put(key, value);
    }

    @Override
    public boolean deleteSetting(String key) {
        return map.remove(key) != null;
    }

    @Override
    public Map<String, String> listSettings() {
        return new HashMap<>(map);
    }
}
