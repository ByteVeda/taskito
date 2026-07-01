package org.byteveda.taskito.spring;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** Configuration for the auto-configured {@link org.byteveda.taskito.Taskito} bean, bound from {@code taskito.*}. */
@ConfigurationProperties(prefix = "taskito")
public class TaskitoProperties {
    /** Connection URL / DSN (e.g. a SQLite path, or a {@code postgres://}/{@code redis://} URL). */
    private String url;

    /** Connection-pool size; unset uses the backend default. */
    private Integer poolSize;

    /** Optional namespace isolating this app's jobs within a shared store. */
    private String namespace;

    public String getUrl() {
        return url;
    }

    public void setUrl(String url) {
        this.url = url;
    }

    public Integer getPoolSize() {
        return poolSize;
    }

    public void setPoolSize(Integer poolSize) {
        this.poolSize = poolSize;
    }

    public String getNamespace() {
        return namespace;
    }

    public void setNamespace(String namespace) {
        this.namespace = namespace;
    }
}
