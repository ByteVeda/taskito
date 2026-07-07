package org.byteveda.taskito.dashboard;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Path;
import org.byteveda.taskito.Taskito;
import org.byteveda.taskito.task.Task;
import org.byteveda.taskito.workflows.Workflow;
import org.byteveda.taskito.workflows.WorkflowRun;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.api.io.TempDir;

/** Coverage of the workflow read endpoints: runs, run detail, DAG, children. */
@Timeout(30)
class DashboardWorkflowTest {

    private static final Task<Integer> STEP = Task.of("wf.step", Integer.class);

    private static Workflow demo() {
        return Workflow.named("demo").step("a", STEP, 1).step("b", STEP, 2, "a");
    }

    @Test
    void listsRunsAndReturnsDetail(@TempDir Path dir) throws Exception {
        try (Taskito queue =
                        Taskito.builder().sqlite(dir.resolve("t.db").toString()).open();
                DashboardServer server = DashboardServer.start(queue, 0)) {
            WorkflowRun run = queue.submitWorkflow(demo());
            String runId = run.id();
            DashboardClient client = new DashboardClient(server.port()).as(DashboardClient.seedAdmin(queue));

            String runs = client.get("/api/workflows/runs").body();
            assertTrue(runs.contains("\"runs\"") && runs.contains(runId));

            String detail = client.get("/api/workflows/runs/" + runId).body();
            assertTrue(detail.contains("\"run\"") && detail.contains("\"nodes\""));
            assertTrue(detail.contains("\"node_name\":\"a\""));

            assertTrue(
                    client.get("/api/workflows/runs/" + runId + "/dag").body().contains("\"dag\""));
            assertTrue(client.get("/api/workflows/runs/" + runId + "/children")
                    .body()
                    .contains("\"children\""));
        }
    }

    @Test
    void missingRunIs404(@TempDir Path dir) throws Exception {
        try (Taskito queue =
                        Taskito.builder().sqlite(dir.resolve("t.db").toString()).open();
                DashboardServer server = DashboardServer.start(queue, 0)) {
            // Touch the workflow store so it exists, then query a missing run.
            queue.submitWorkflow(demo());
            DashboardClient client = new DashboardClient(server.port()).as(DashboardClient.seedAdmin(queue));
            assertEquals(404, client.get("/api/workflows/runs/nope").statusCode());
            assertEquals(404, client.get("/api/workflows/runs/nope/dag").statusCode());
        }
    }
}
