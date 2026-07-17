package org.byteveda.taskito.worker;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

import java.util.Map;
import org.junit.jupiter.api.Test;

class RetentionTest {

    @Test
    void toMapKeepsOnlySetWindowsWithCamelCaseKeys() {
        Map<String, Object> map = Retention.builder()
                .archivedJobs(604_800)
                .taskLogs(259_200)
                .build()
                .toMap();

        assertEquals(604_800, map.get("archivedJobs"));
        assertEquals(259_200, map.get("taskLogs"));
        assertFalse(map.containsKey("deadLetter"), "an unset window must be omitted");
        assertEquals(2, map.size());
    }

    @Test
    void emptyRetentionEncodesEmptyMap() {
        assertEquals(0, Retention.builder().build().toMap().size());
    }
}
