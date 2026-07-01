package org.byteveda.taskito.spring;

import org.byteveda.taskito.Taskito;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;

/**
 * Auto-configures a single {@link Taskito} bean from {@link TaskitoProperties}.
 * The bean is closed with the application context. Define your own {@code Taskito}
 * bean to override it.
 */
@AutoConfiguration
@ConditionalOnClass(Taskito.class)
@EnableConfigurationProperties(TaskitoProperties.class)
public class TaskitoAutoConfiguration {

    @Bean(destroyMethod = "close")
    @ConditionalOnMissingBean
    public Taskito taskito(TaskitoProperties properties) {
        Taskito.Builder builder = Taskito.builder();
        if (properties.getUrl() != null) {
            builder.url(properties.getUrl());
        }
        if (properties.getPoolSize() != null) {
            builder.poolSize(properties.getPoolSize());
        }
        if (properties.getNamespace() != null) {
            builder.namespace(properties.getNamespace());
        }
        return builder.open();
    }
}
