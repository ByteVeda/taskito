package org.byteveda.taskito.workflows;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import org.byteveda.taskito.task.Task;

/**
 * A workflow definition: a named, versioned DAG of {@link Step}s. Build one, then
 * submit it with {@code Queue.submitWorkflow}. Steps run in topological order;
 * a step waits for every predecessor named in its {@code after} list.
 */
public final class Workflow {
    private final String name;
    private int version = 1;
    private final List<Step> steps = new ArrayList<>();

    private Workflow(String name) {
        this.name = name;
    }

    /** Start a workflow named {@code name} (version defaults to 1). */
    public static Workflow named(String name) {
        return new Workflow(name);
    }

    /** Set the definition version. Bumping it lets the DAG change without conflict. */
    public Workflow version(int version) {
        this.version = version;
        return this;
    }

    /** Add a step that runs after the named predecessors, using the task's defaults. */
    public <T> Workflow step(String name, Task<T> task, T payload, String... after) {
        return step(Step.of(name, task, payload).after(after).build());
    }

    /** Add a fully-configured step. */
    public Workflow step(Step step) {
        steps.add(step);
        return this;
    }

    public String name() {
        return name;
    }

    public int version() {
        return version;
    }

    public List<Step> steps() {
        return Collections.unmodifiableList(steps);
    }
}
