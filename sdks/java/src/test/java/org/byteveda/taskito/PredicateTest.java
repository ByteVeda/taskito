package org.byteveda.taskito;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Path;
import org.byteveda.taskito.errors.PredicateRejectedException;
import org.byteveda.taskito.predicates.Predicate;
import org.byteveda.taskito.predicates.PredicateContext;
import org.byteveda.taskito.predicates.Predicates;
import org.byteveda.taskito.task.Task;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class PredicateTest {

    private static final Task<Integer> TASK = Task.of("p.task", Integer.class);

    @Test
    void allowsWhenPredicatePasses(@TempDir Path dir) {
        try (Taskito queue =
                Taskito.builder().url(dir.resolve("p.db").toString()).open()) {
            queue.predicate("p.task", ctx -> (Integer) ctx.payload() > 0);
            assertNotNull(queue.enqueue(TASK, 5));
        }
    }

    @Test
    void rejectsWhenPredicateFails(@TempDir Path dir) {
        try (Taskito queue =
                Taskito.builder().url(dir.resolve("p.db").toString()).open()) {
            queue.predicate("p.task", ctx -> (Integer) ctx.payload() > 0);
            assertThrows(PredicateRejectedException.class, () -> queue.enqueue(TASK, -1));
        }
    }

    @Test
    void combinators() {
        Predicate even = ctx -> (Integer) ctx.payload() % 2 == 0;
        Predicate positive = ctx -> (Integer) ctx.payload() > 0;

        assertTrue(Predicates.allOf(even, positive).test(ctx(4)));
        assertFalse(Predicates.allOf(even, positive).test(ctx(3)));
        assertTrue(Predicates.anyOf(even, positive).test(ctx(3))); // positive
        assertFalse(Predicates.anyOf(even, positive).test(ctx(-1)));
        assertTrue(Predicates.not(even).test(ctx(3)));
    }

    private static PredicateContext ctx(int payload) {
        return new PredicateContext("p.task", payload);
    }
}
