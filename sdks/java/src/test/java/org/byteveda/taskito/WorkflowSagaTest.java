package org.byteveda.taskito;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.nio.file.Path;
import java.time.Duration;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.byteveda.taskito.task.Task;
import org.byteveda.taskito.worker.Worker;
import org.byteveda.taskito.workflows.NodeStatus;
import org.byteveda.taskito.workflows.Step;
import org.byteveda.taskito.workflows.Workflow;
import org.byteveda.taskito.workflows.WorkflowRun;
import org.byteveda.taskito.workflows.WorkflowState;
import org.byteveda.taskito.workflows.WorkflowStatus;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.api.io.TempDir;

class WorkflowSagaTest {

    private static final Task<Integer> A = Task.of("sg.a", Integer.class);
    private static final Task<Integer> B = Task.of("sg.b", Integer.class);
    private static final Task<Integer> C = Task.of("sg.c", Integer.class);
    private static final Task<Integer> UNDO_A = Task.of("sg.undoA", Integer.class);
    private static final Task<Integer> UNDO_B = Task.of("sg.undoB", Integer.class);

    @Test
    @Timeout(30)
    void compensatesCompletedStepsOnFailure(@TempDir Path dir) throws Exception {
        try (Taskito queue =
                Taskito.builder().url(dir.resolve("sg.db").toString()).open()) {
            Workflow wf = Workflow.named("saga")
                    .step(Step.of("a", A, 1).compensate(UNDO_A).build())
                    .step(Step.of("b", B, 2).after("a").compensate(UNDO_B).build())
                    .step(Step.of("c", C, 3).after("b").maxRetries(0).build());

            WorkflowRun run = queue.submitWorkflow(wf);
            Set<Integer> undone = ConcurrentHashMap.newKeySet();
            try (Worker worker = queue.worker()
                    .handle(A, p -> p)
                    .handle(B, p -> p)
                    .handle(C, p -> {
                        throw new IllegalStateException("boom");
                    })
                    .handle(UNDO_A, p -> {
                        undone.add(100 + p);
                        return p;
                    })
                    .handle(UNDO_B, p -> {
                        undone.add(200 + p);
                        return p;
                    })
                    .trackWorkflows()
                    .start()) {
                WorkflowStatus status = run.await(Duration.ofSeconds(20));
                assertEquals(WorkflowState.COMPENSATED, status.state);
                assertEquals(NodeStatus.COMPENSATED, status.node("a").orElseThrow().status);
                assertEquals(NodeStatus.COMPENSATED, status.node("b").orElseThrow().status);
                assertEquals(NodeStatus.FAILED, status.node("c").orElseThrow().status);
                // undoA saw a's result (1) → 101; undoB saw b's result (2) → 202.
                assertEquals(Set.of(101, 202), undone);
            }
        }
    }

    @Test
    @Timeout(30)
    void noCompensatorsStillFailsNormally(@TempDir Path dir) throws Exception {
        try (Taskito queue =
                Taskito.builder().url(dir.resolve("sg2.db").toString()).open()) {
            Workflow wf = Workflow.named("plain")
                    .step("a", A, 1)
                    .step(Step.of("b", B, 2).after("a").maxRetries(0).build());

            WorkflowRun run = queue.submitWorkflow(wf);
            try (Worker worker = queue.worker()
                    .handle(A, p -> p)
                    .handle(B, p -> {
                        throw new IllegalStateException("boom");
                    })
                    .trackWorkflows()
                    .start()) {
                WorkflowStatus status = run.await(Duration.ofSeconds(20));
                assertEquals(WorkflowState.FAILED, status.state);
            }
        }
    }
}
