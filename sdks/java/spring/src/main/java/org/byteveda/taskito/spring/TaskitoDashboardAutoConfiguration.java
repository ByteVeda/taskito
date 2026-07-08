package org.byteveda.taskito.spring;

import java.io.IOException;
import org.byteveda.taskito.Taskito;
import org.byteveda.taskito.dashboard.DashboardServer;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;

/**
 * Auto-starts a {@link DashboardServer} over the {@link Taskito} bean when
 * {@code taskito.dashboard.enabled=true}. The server is stopped with the
 * application context. Define your own {@code DashboardServer} bean to override.
 */
@AutoConfiguration(after = TaskitoAutoConfiguration.class)
@ConditionalOnClass({Taskito.class, DashboardServer.class})
@ConditionalOnProperty(prefix = "taskito.dashboard", name = "enabled", havingValue = "true")
@EnableConfigurationProperties(TaskitoProperties.class)
public class TaskitoDashboardAutoConfiguration {

    @Bean(destroyMethod = "close")
    @ConditionalOnBean(Taskito.class)
    @ConditionalOnMissingBean
    public DashboardServer taskitoDashboardServer(Taskito taskito, TaskitoProperties properties) throws IOException {
        TaskitoProperties.Dashboard dashboard = properties.getDashboard();
        return DashboardServer.start(
                taskito,
                dashboard.getPort(),
                dashboard.getToken(),
                dashboard.getStaticDir(),
                dashboard.isSecureCookies());
    }
}
