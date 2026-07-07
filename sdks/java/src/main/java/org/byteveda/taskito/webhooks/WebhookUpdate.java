package org.byteveda.taskito.webhooks;

import java.util.List;
import java.util.Map;

/**
 * A partial webhook edit. Every field is nullable: {@code null} leaves the
 * corresponding webhook field unchanged, while a provided value replaces it
 * wholesale (for {@code events} and {@code headers} the whole collection is
 * swapped, not merged). Consumed by {@link WebhookManager#update}.
 */
public record WebhookUpdate(
        String url,
        List<String> events,
        String taskFilter,
        Map<String, String> headers,
        String secret,
        Integer maxRetries,
        Long timeoutMs,
        Boolean enabled,
        String description) {

    public static Builder builder() {
        return new Builder();
    }

    /** Fluent builder so callers set only the fields they intend to change. */
    public static final class Builder {
        private String url;
        private List<String> events;
        private String taskFilter;
        private Map<String, String> headers;
        private String secret;
        private Integer maxRetries;
        private Long timeoutMs;
        private Boolean enabled;
        private String description;

        private Builder() {}

        public Builder url(String url) {
            this.url = url;
            return this;
        }

        public Builder events(List<String> events) {
            this.events = events;
            return this;
        }

        public Builder taskFilter(String taskFilter) {
            this.taskFilter = taskFilter;
            return this;
        }

        public Builder headers(Map<String, String> headers) {
            this.headers = headers;
            return this;
        }

        public Builder secret(String secret) {
            this.secret = secret;
            return this;
        }

        public Builder maxRetries(Integer maxRetries) {
            this.maxRetries = maxRetries;
            return this;
        }

        public Builder timeoutMs(Long timeoutMs) {
            this.timeoutMs = timeoutMs;
            return this;
        }

        public Builder enabled(Boolean enabled) {
            this.enabled = enabled;
            return this;
        }

        public Builder description(String description) {
            this.description = description;
            return this;
        }

        public WebhookUpdate build() {
            return new WebhookUpdate(
                    url, events, taskFilter, headers, secret, maxRetries, timeoutMs, enabled, description);
        }
    }
}
