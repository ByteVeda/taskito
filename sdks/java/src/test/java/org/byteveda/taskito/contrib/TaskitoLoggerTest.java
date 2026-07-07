package org.byteveda.taskito.contrib;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;
import org.byteveda.taskito.logging.LogLevel;
import org.byteveda.taskito.logging.TaskitoLogger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

class TaskitoLoggerTest {
    private final List<String> lines = new ArrayList<>();

    @AfterEach
    void restoreDefaults() {
        TaskitoLogger.setLevel(LogLevel.WARN);
        TaskitoLogger.setSink((level, line) -> System.err.println(line));
    }

    @Test
    void dropsMessagesBelowThresholdAndTagsNamespace() {
        TaskitoLogger.setSink((level, line) -> lines.add(line));
        TaskitoLogger.setLevel(LogLevel.WARN);
        TaskitoLogger log = TaskitoLogger.create("worker");

        log.info("dropped");
        log.warn("kept");

        assertEquals(1, lines.size());
        assertTrue(lines.get(0).contains("[taskito:worker] WARN kept"));
    }

    @Test
    void appendsStackTraceForThrowables() {
        TaskitoLogger.setSink((level, line) -> lines.add(line));
        TaskitoLogger.setLevel(LogLevel.ERROR);

        TaskitoLogger.root().error("boom", new IllegalStateException("cause detail"));

        assertEquals(1, lines.size());
        assertTrue(lines.get(0).contains("[taskito] ERROR boom"));
        assertTrue(lines.get(0).contains("IllegalStateException: cause detail"));
    }

    @Test
    void silentDisablesEverything() {
        TaskitoLogger.setSink((level, line) -> lines.add(line));
        TaskitoLogger.setLevel(LogLevel.SILENT);

        TaskitoLogger.root().error("never emitted");

        assertTrue(lines.isEmpty());
    }
}
