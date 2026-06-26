package org.byteveda.taskito;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.LinkedHashMap;
import java.util.Map;
import org.byteveda.taskito.internal.JniQueueBackend;
import org.byteveda.taskito.serialization.JsonSerializer;
import org.byteveda.taskito.serialization.Serializer;
import org.byteveda.taskito.spi.QueueBackend;

/** Entry point: open a {@link Queue} over a storage backend. */
public final class Taskito {
    private Taskito() {}

    public static Builder builder() {
        return new Builder();
    }

    /** Configures and opens a {@link Queue}. */
    public static final class Builder {
        private static final ObjectMapper JSON = new ObjectMapper();

        private final Map<String, Object> options = new LinkedHashMap<>();
        private Serializer serializer = new JsonSerializer();

        public Builder backend(String backend) {
            options.put("backend", backend);
            return this;
        }

        /** Connection string: a file path for SQLite, a URL for Postgres/Redis. */
        public Builder url(String dsn) {
            options.put("dsn", dsn);
            return this;
        }

        /** Shortcut for {@code backend("sqlite").url(path)}. */
        public Builder sqlite(String path) {
            return backend("sqlite").url(path);
        }

        /** Shortcut for {@code backend("postgres").url(url)}. */
        public Builder postgres(String url) {
            return backend("postgres").url(url);
        }

        /** Shortcut for {@code backend("redis").url(url)}. */
        public Builder redis(String url) {
            return backend("redis").url(url);
        }

        public Builder poolSize(int poolSize) {
            options.put("poolSize", poolSize);
            return this;
        }

        public Builder schema(String schema) {
            options.put("schema", schema);
            return this;
        }

        public Builder prefix(String prefix) {
            options.put("prefix", prefix);
            return this;
        }

        public Builder namespace(String namespace) {
            options.put("namespace", namespace);
            return this;
        }

        public Builder serializer(Serializer serializer) {
            this.serializer = serializer;
            return this;
        }

        /** Open over an explicit backend, e.g. an in-memory fake in tests. */
        public Queue open(QueueBackend backend) {
            return new DefaultQueue(backend, serializer);
        }

        /** Open the native backend described by the configured options. */
        public Queue open() {
            if (!options.containsKey("dsn")) {
                throw new TaskitoException("url (dsn) is required");
            }
            return new DefaultQueue(JniQueueBackend.open(encodeOptions()), serializer);
        }

        private String encodeOptions() {
            try {
                return JSON.writeValueAsString(options);
            } catch (Exception e) {
                throw new TaskitoException("failed to encode open options", e);
            }
        }
    }
}
