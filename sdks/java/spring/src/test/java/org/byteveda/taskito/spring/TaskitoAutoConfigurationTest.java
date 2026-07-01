package org.byteveda.taskito.spring;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Path;
import org.byteveda.taskito.Taskito;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

class TaskitoAutoConfigurationTest {

    private final ApplicationContextRunner runner =
            new ApplicationContextRunner().withConfiguration(AutoConfigurations.of(TaskitoAutoConfiguration.class));

    @Test
    @Timeout(30)
    void providesTaskitoBeanFromProperties(@TempDir Path dir) {
        runner.withPropertyValues("taskito.url=" + dir.resolve("s.db")).run(ctx -> {
            assertTrue(ctx.getStartupFailure() == null);
            assertNotNull(ctx.getBean(Taskito.class));
        });
    }
}
