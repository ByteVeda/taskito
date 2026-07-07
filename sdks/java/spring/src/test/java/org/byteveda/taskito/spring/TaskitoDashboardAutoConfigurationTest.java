package org.byteveda.taskito.spring;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Path;
import org.byteveda.taskito.dashboard.DashboardServer;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

class TaskitoDashboardAutoConfigurationTest {

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withConfiguration(
                    AutoConfigurations.of(TaskitoAutoConfiguration.class, TaskitoDashboardAutoConfiguration.class));

    @Test
    @Timeout(30)
    void noDashboardBeanByDefault(@TempDir Path dir) {
        runner.withPropertyValues("taskito.url=" + dir.resolve("s.db")).run(ctx -> {
            assertNull(ctx.getStartupFailure());
            assertFalse(ctx.containsBean("taskitoDashboardServer"));
        });
    }

    @Test
    @Timeout(30)
    void startsDashboardWhenEnabled(@TempDir Path dir) {
        runner.withPropertyValues(
                        "taskito.url=" + dir.resolve("s.db"),
                        "taskito.dashboard.enabled=true",
                        "taskito.dashboard.port=0")
                .run(ctx -> {
                    assertNull(ctx.getStartupFailure());
                    DashboardServer server = ctx.getBean(DashboardServer.class);
                    assertTrue(server.port() > 0);
                });
    }
}
