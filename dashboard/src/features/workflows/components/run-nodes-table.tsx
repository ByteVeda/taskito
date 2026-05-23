import { Card } from "@/components/ui";
import { formatAbsolute, formatRelative } from "@/lib/time";
import type { WorkflowNode } from "../types";
import { WorkflowNodeStatusBadge } from "./state-badge";

export function RunNodesTable({ nodes }: { nodes: WorkflowNode[] }) {
  if (nodes.length === 0) {
    return <Card className="p-4 text-sm text-[var(--fg-muted)]">No nodes recorded yet.</Card>;
  }
  return (
    <Card className="overflow-hidden">
      <table className="w-full text-sm">
        <thead className="border-b text-left text-xs text-[var(--fg-muted)]">
          <tr>
            <th className="px-3 py-2">Node</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Job</th>
            <th className="px-3 py-2">Started</th>
            <th className="px-3 py-2">Completed</th>
          </tr>
        </thead>
        <tbody>
          {nodes.map((n) => (
            <tr key={n.node_name} className="border-b last:border-b-0">
              <td className="px-3 py-2 font-mono text-xs">{n.node_name}</td>
              <td className="px-3 py-2">
                <WorkflowNodeStatusBadge status={n.status} />
              </td>
              <td className="px-3 py-2 font-mono text-xs text-[var(--fg-muted)]">
                {n.job_id ? (
                  <a href={`/jobs/${n.job_id}`} className="text-accent hover:underline">
                    {n.job_id.slice(0, 8)}…
                  </a>
                ) : (
                  "—"
                )}
              </td>
              <td
                className="px-3 py-2 text-xs text-[var(--fg-muted)]"
                title={n.started_at ? formatAbsolute(n.started_at) : "—"}
              >
                {n.started_at ? formatRelative(n.started_at) : "—"}
              </td>
              <td
                className="px-3 py-2 text-xs text-[var(--fg-muted)]"
                title={n.completed_at ? formatAbsolute(n.completed_at) : "—"}
              >
                {n.completed_at ? formatRelative(n.completed_at) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
