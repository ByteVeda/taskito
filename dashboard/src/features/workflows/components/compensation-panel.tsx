import { Card } from "@/components/ui";
import { formatAbsolute, formatRelative } from "@/lib/time";
import type { WorkflowNode } from "../types";

interface CompensationPanelProps {
  nodes: WorkflowNode[];
}

/**
 * Surfaces the saga-compensation lifecycle for a workflow run.
 *
 * Only renders nodes that have at least one compensation field populated
 * (job ID, started_at, completed_at, or error). When the run is in a
 * non-compensation state, this panel returns null — the parent decides
 * whether to show it via ``shouldShowCompensationPanel(run.state)``.
 */
export function CompensationPanel({ nodes }: CompensationPanelProps) {
  const rows = nodes.filter(
    (n) =>
      n.compensation_job_id !== null ||
      n.compensation_started_at !== null ||
      n.compensation_completed_at !== null ||
      n.compensation_error !== null,
  );
  if (rows.length === 0) {
    return (
      <Card className="p-4 text-sm text-[var(--fg-muted)]">
        Compensation is in progress, but no nodes have been dispatched yet.
      </Card>
    );
  }
  return (
    <Card className="overflow-hidden">
      <div className="border-b px-4 py-3 text-sm font-medium">Compensation</div>
      <table className="w-full text-sm">
        <thead className="border-b text-left text-xs text-[var(--fg-muted)]">
          <tr>
            <th className="px-3 py-2">Node</th>
            <th className="px-3 py-2">Compensation job</th>
            <th className="px-3 py-2">Started</th>
            <th className="px-3 py-2">Completed</th>
            <th className="px-3 py-2">Error</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((n) => (
            <tr key={n.node_name} className="border-b last:border-b-0">
              <td className="px-3 py-2 font-mono text-xs">{n.node_name}</td>
              <td className="px-3 py-2 font-mono text-xs text-[var(--fg-muted)]">
                {n.compensation_job_id ? (
                  <a
                    href={`/jobs/${n.compensation_job_id}`}
                    className="text-accent hover:underline"
                  >
                    {n.compensation_job_id.slice(0, 8)}…
                  </a>
                ) : (
                  "—"
                )}
              </td>
              <td
                className="px-3 py-2 text-xs text-[var(--fg-muted)]"
                title={n.compensation_started_at ? formatAbsolute(n.compensation_started_at) : "—"}
              >
                {n.compensation_started_at ? formatRelative(n.compensation_started_at) : "—"}
              </td>
              <td
                className="px-3 py-2 text-xs text-[var(--fg-muted)]"
                title={
                  n.compensation_completed_at ? formatAbsolute(n.compensation_completed_at) : "—"
                }
              >
                {n.compensation_completed_at ? formatRelative(n.compensation_completed_at) : "—"}
              </td>
              <td className="px-3 py-2 text-xs text-danger" title={n.compensation_error ?? "—"}>
                {n.compensation_error
                  ? `${n.compensation_error.slice(0, 40)}${n.compensation_error.length > 40 ? "…" : ""}`
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
