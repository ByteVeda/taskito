package org.byteveda.taskito.webhooks;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.byteveda.taskito.events.EventName;

/** A stored webhook subscription. Timestamps are Unix milliseconds. */
@JsonIgnoreProperties(ignoreUnknown = true)
public final class Webhook {
    public final String id;
    public final String url;
    /** Outcome wire names this hook fires on: success/retry/dead/cancelled. */
    public final List<String> events;
    public final String taskFilter;
    public final Map<String, String> headers;
    public final String secret;
    public final int maxRetries;
    public final long timeoutMs;
    public final boolean enabled;
    public final String description;
    public final long createdAt;
    public final long updatedAt;

    @JsonCreator
    Webhook(
            @JsonProperty("id") String id,
            @JsonProperty("url") String url,
            @JsonProperty("events") List<String> events,
            @JsonProperty("taskFilter") String taskFilter,
            @JsonProperty("headers") Map<String, String> headers,
            @JsonProperty("secret") String secret,
            @JsonProperty("maxRetries") int maxRetries,
            @JsonProperty("timeoutMs") long timeoutMs,
            @JsonProperty("enabled") boolean enabled,
            @JsonProperty("description") String description,
            @JsonProperty("createdAt") long createdAt,
            @JsonProperty("updatedAt") long updatedAt) {
        this.id = id;
        this.url = url;
        this.events = events == null ? Collections.emptyList() : events;
        this.taskFilter = taskFilter;
        this.headers = headers == null ? Collections.emptyMap() : headers;
        this.secret = secret;
        this.maxRetries = maxRetries;
        this.timeoutMs = timeoutMs;
        this.enabled = enabled;
        this.description = description;
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
    }

    public static Builder builder(String url) {
        return new Builder(url);
    }

    /** A draft webhook; the manager assigns its id and timestamps on create. */
    public static final class Builder {
        final String url;
        final List<String> events = new ArrayList<>();
        final Map<String, String> headers = new LinkedHashMap<>();
        String taskFilter;
        String secret;
        int maxRetries = 3;
        long timeoutMs = 10_000;
        boolean enabled = true;
        String description;

        Builder(String url) {
            this.url = url;
        }

        public Builder on(EventName... names) {
            for (EventName name : names) {
                events.add(name.name().toLowerCase(java.util.Locale.ROOT));
            }
            return this;
        }

        public Builder taskFilter(String taskFilter) {
            this.taskFilter = taskFilter;
            return this;
        }

        public Builder header(String name, String value) {
            headers.put(name, value);
            return this;
        }

        public Builder secret(String secret) {
            this.secret = secret;
            return this;
        }

        public Builder maxRetries(int maxRetries) {
            this.maxRetries = maxRetries;
            return this;
        }

        public Builder timeoutMs(long timeoutMs) {
            this.timeoutMs = timeoutMs;
            return this;
        }

        public Builder enabled(boolean enabled) {
            this.enabled = enabled;
            return this;
        }

        public Builder description(String description) {
            this.description = description;
            return this;
        }
    }
}
