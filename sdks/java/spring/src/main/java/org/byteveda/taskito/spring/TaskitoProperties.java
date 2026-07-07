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

    /** Dashboard server settings, bound from {@code taskito.dashboard.*}. */
    private final Dashboard dashboard = new Dashboard();

    public Dashboard getDashboard() {
        return dashboard;
    }

    /** Auto-configuration for the bundled dashboard HTTP server. */
    public static class Dashboard {
        /** Whether to auto-start a {@code DashboardServer} bean. Off by default. */
        private boolean enabled = false;

        /** Port to bind (0 = ephemeral). */
        private int port = 8080;

        /** Optional shared token gating {@code /api/*}; null enables the session flow. */
        private String token;

        /** Optional unpacked SPA directory; null auto-discovers the bundled assets. */
        private String staticDir;

        /** Whether to keep the {@code Secure} cookie attribute (drop it for local HTTP). */
        private boolean secureCookies = true;

        public boolean isEnabled() {
            return enabled;
        }

        public void setEnabled(boolean enabled) {
            this.enabled = enabled;
        }

        public int getPort() {
            return port;
        }

        public void setPort(int port) {
            this.port = port;
        }

        public String getToken() {
            return token;
        }

        public void setToken(String token) {
            this.token = token;
        }

        public String getStaticDir() {
            return staticDir;
        }

        public void setStaticDir(String staticDir) {
            this.staticDir = staticDir;
        }

        public boolean isSecureCookies() {
            return secureCookies;
        }

        public void setSecureCookies(boolean secureCookies) {
            this.secureCookies = secureCookies;
        }
    }
}
