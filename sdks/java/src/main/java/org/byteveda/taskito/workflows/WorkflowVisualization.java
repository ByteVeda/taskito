package org.byteveda.taskito.workflows;

/**
 * Renders a {@link Workflow}'s DAG as text for docs or debugging: Mermaid
 * ({@code graph TD}) or Graphviz DOT. Node labels note the step kind (gate,
 * fan-out, fan-in, sub-workflow, conditional).
 */
public final class WorkflowVisualization {
    private WorkflowVisualization() {}

    /** A Mermaid {@code graph TD} diagram of the workflow. */
    public static String mermaid(Workflow workflow) {
        StringBuilder out = new StringBuilder("graph TD\n");
        for (Step step : workflow.steps()) {
            String id = id(step.name);
            String label = quote(label(step));
            if (step.gate != null) {
                out.append("  ").append(id).append("{").append(label).append("}\n");
            } else {
                out.append("  ").append(id).append("[").append(label).append("]\n");
            }
        }
        for (Step step : workflow.steps()) {
            for (String pred : step.after) {
                out.append("  ")
                        .append(id(pred))
                        .append(" --> ")
                        .append(id(step.name))
                        .append("\n");
            }
        }
        return out.toString();
    }

    /** A Graphviz DOT digraph of the workflow. */
    public static String dot(Workflow workflow) {
        StringBuilder out =
                new StringBuilder("digraph ").append(quote(workflow.name())).append(" {\n");
        for (Step step : workflow.steps()) {
            out.append("  ")
                    .append(quote(step.name))
                    .append(" [label=")
                    .append(quote(label(step)))
                    .append("];\n");
        }
        for (Step step : workflow.steps()) {
            for (String pred : step.after) {
                out.append("  ")
                        .append(quote(pred))
                        .append(" -> ")
                        .append(quote(step.name))
                        .append(";\n");
            }
        }
        return out.append("}\n").toString();
    }

    private static String label(Step step) {
        String kind = kind(step);
        return kind == null ? step.name : step.name + " (" + kind + ")";
    }

    private static String kind(Step step) {
        if (step.gate != null) {
            return "gate";
        }
        if (step.subWorkflow != null) {
            return "sub-workflow";
        }
        if (step.fanOut != null) {
            return "fan-out";
        }
        if (step.fanIn != null) {
            return "fan-in";
        }
        if (step.condition != null) {
            return "conditional";
        }
        return null;
    }

    /** A Mermaid-safe node id (only the structure uses it; the label keeps the real name). */
    private static String id(String name) {
        return "n_" + name.replaceAll("[^A-Za-z0-9_]", "_");
    }

    private static String quote(String text) {
        return '"' + text.replace("\"", "\\\"") + '"';
    }
}
