import { Link } from "@tanstack/react-router";
import { GitBranch } from "lucide-react";
import { Badge, EmptyState, ErrorState, Skeleton } from "@/components/ui";
import type { WorkflowRun } from "@/lib/api-types";
import { WORKFLOW_STATE_LABEL, WORKFLOW_STATE_TONE } from "@/lib/status";
import { formatAbsolute, formatDuration, formatRelative } from "@/lib/time";

interface Props {
  runs: WorkflowRun[] | undefined;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
}

export function WorkflowRunsTable({ runs, loading, error, onRetry }: Props) {
  if (error) {
    return (
      <ErrorState
        title="Couldn't load workflow runs"
        description={error.message}
        onRetry={onRetry}
      />
    );
  }

  if (loading && !runs) return <Skeleton className="h-64 w-full" />;

  if (!runs || runs.length === 0) {
    return (
      <EmptyState
        icon={GitBranch}
        title="No workflow runs"
        description="Workflow runs will appear here once a workflow is submitted."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg ring-1 ring-inset ring-[var(--border)]">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-[var(--border)] bg-[var(--surface-2)] text-[0.74rem] font-medium text-[var(--fg-muted)]">
          <tr>
            <th className="px-4 py-2.5">Run ID</th>
            <th className="px-4 py-2.5">Definition</th>
            <th className="px-4 py-2.5">State</th>
            <th className="px-4 py-2.5">Created</th>
            <th className="px-4 py-2.5">Duration</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {runs.map((run) => (
            <RunRow key={run.id} run={run} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RunRow({ run }: { run: WorkflowRun }) {
  const tone = WORKFLOW_STATE_TONE[run.state];
  const duration =
    run.started_at != null && run.completed_at != null
      ? formatDuration(run.completed_at - run.started_at)
      : run.started_at != null
        ? "running…"
        : "—";

  return (
    <tr className="bg-[var(--surface)] transition-colors hover:bg-[var(--surface-2)]/50">
      <td className="px-4 py-3">
        <Link
          to="/workflows/$id"
          params={{ id: run.id }}
          className="font-mono text-[0.8rem] text-accent hover:underline"
        >
          {run.id.slice(0, 12)}…
        </Link>
      </td>
      <td className="px-4 py-3 font-mono text-[0.8rem]">{run.definition_id}</td>
      <td className="px-4 py-3">
        <Badge tone={tone}>{WORKFLOW_STATE_LABEL[run.state]}</Badge>
      </td>
      <td className="px-4 py-3 text-[var(--fg-muted)]" title={formatAbsolute(run.created_at)}>
        {formatRelative(run.created_at)}
      </td>
      <td className="px-4 py-3 font-mono text-[0.8rem] tabular-nums text-[var(--fg-muted)]">
        {duration}
      </td>
    </tr>
  );
}
