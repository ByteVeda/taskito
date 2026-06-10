import { Link } from "@tanstack/react-router";
import { Layers } from "lucide-react";
import { Badge, EmptyState } from "@/components/ui";
import type { WorkflowNode } from "@/lib/api-types";
import { WORKFLOW_NODE_LABEL, WORKFLOW_NODE_TONE } from "@/lib/status";
import { formatDuration, formatRelative } from "@/lib/time";

interface Props {
  nodes: WorkflowNode[];
}

export function WorkflowNodesTable({ nodes }: Props) {
  if (nodes.length === 0) {
    return (
      <EmptyState
        icon={Layers}
        title="No nodes"
        description="This workflow run has no nodes yet."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg ring-1 ring-inset ring-[var(--border)]">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-[var(--border)] bg-[var(--surface-2)] text-[0.74rem] font-medium text-[var(--fg-muted)]">
          <tr>
            <th className="px-4 py-2.5">Node</th>
            <th className="px-4 py-2.5">Status</th>
            <th className="px-4 py-2.5">Job</th>
            <th className="px-4 py-2.5">Started</th>
            <th className="px-4 py-2.5">Duration</th>
            <th className="px-4 py-2.5">Error</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {nodes.map((node) => (
            <NodeRow key={node.node_name} node={node} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NodeRow({ node }: { node: WorkflowNode }) {
  const tone = WORKFLOW_NODE_TONE[node.status];
  const duration =
    node.started_at != null && node.completed_at != null
      ? formatDuration(node.completed_at - node.started_at)
      : null;

  return (
    <tr className="bg-[var(--surface)] transition-colors hover:bg-[var(--surface-2)]/50">
      <td className="px-4 py-3 font-medium">{node.node_name}</td>
      <td className="px-4 py-3">
        <Badge tone={tone}>{WORKFLOW_NODE_LABEL[node.status]}</Badge>
      </td>
      <td className="px-4 py-3">
        {node.job_id ? (
          <Link
            to="/jobs/$id"
            params={{ id: node.job_id }}
            className="font-mono text-[0.8rem] text-accent hover:underline"
          >
            {node.job_id.slice(0, 8)}…
          </Link>
        ) : (
          <span className="text-[var(--fg-subtle)]">—</span>
        )}
      </td>
      <td className="px-4 py-3 text-[var(--fg-muted)]">
        {node.started_at != null ? formatRelative(node.started_at) : "—"}
      </td>
      <td className="px-4 py-3 font-mono text-[0.8rem] tabular-nums text-[var(--fg-muted)]">
        {duration ?? "—"}
      </td>
      <td className="max-w-[200px] truncate px-4 py-3 text-[0.8rem] text-danger">
        {node.error ?? ""}
      </td>
    </tr>
  );
}
