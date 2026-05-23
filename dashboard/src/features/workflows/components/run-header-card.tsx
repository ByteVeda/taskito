import { Card } from "@/components/ui";
import { formatAbsolute, formatRelative } from "@/lib/time";
import type { WorkflowRun } from "../types";
import { WorkflowStateBadge } from "./state-badge";

export function RunHeaderCard({ run }: { run: WorkflowRun }) {
  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs text-[var(--fg-muted)]">Run ID</div>
          <div className="font-mono text-sm text-[var(--fg)]">{run.id}</div>
          <div className="mt-3 text-xs text-[var(--fg-muted)]">Definition</div>
          <div className="font-mono text-sm text-[var(--fg)]">{run.definition_id}</div>
        </div>
        <WorkflowStateBadge state={run.state} />
      </div>

      <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-[var(--fg-muted)]">Created</dt>
          <dd className="text-[var(--fg)]" title={formatAbsolute(run.created_at)}>
            {formatRelative(run.created_at)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--fg-muted)]">Started</dt>
          <dd
            className="text-[var(--fg)]"
            title={run.started_at ? formatAbsolute(run.started_at) : "—"}
          >
            {run.started_at ? formatRelative(run.started_at) : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--fg-muted)]">Completed</dt>
          <dd
            className="text-[var(--fg)]"
            title={run.completed_at ? formatAbsolute(run.completed_at) : "—"}
          >
            {run.completed_at ? formatRelative(run.completed_at) : "—"}
          </dd>
        </div>
      </dl>

      {run.error && (
        <div className="mt-6 rounded border-l-2 border-danger bg-danger-dim px-3 py-2 text-xs text-danger">
          {run.error}
        </div>
      )}

      {run.parent_run_id && (
        <div className="mt-4 text-xs text-[var(--fg-muted)]">
          Sub-workflow of:{" "}
          <a
            href={`/workflows/${run.parent_run_id}`}
            className="font-mono text-accent hover:underline"
          >
            {run.parent_run_id.slice(0, 8)}…
          </a>
          {run.parent_node_name && (
            <>
              {" "}
              at node <span className="font-mono">{run.parent_node_name}</span>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
