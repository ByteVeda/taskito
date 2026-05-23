import { useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { DataTable, EmptyState, ErrorState, TableSkeleton } from "@/components/ui";
import { formatAbsolute, formatRelative } from "@/lib/time";
import type { WorkflowRun } from "../types";
import { WorkflowStateBadge } from "./state-badge";

interface WorkflowsListTableProps {
  runs: WorkflowRun[] | undefined;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
}

export function WorkflowsListTable({ runs, loading, error, onRetry }: WorkflowsListTableProps) {
  const navigate = useNavigate();

  const columns = useMemo<ColumnDef<WorkflowRun>[]>(
    () => [
      {
        accessorKey: "id",
        header: "Run",
        cell: ({ getValue }) => (
          <span className="font-mono text-xs text-accent">{getValue<string>().slice(0, 8)}…</span>
        ),
      },
      {
        accessorKey: "definition_id",
        header: "Definition",
        cell: ({ getValue }) => (
          <span className="truncate text-xs text-[var(--fg-muted)]">
            {getValue<string>().slice(0, 8)}…
          </span>
        ),
      },
      {
        accessorKey: "state",
        header: "State",
        cell: ({ row }) => <WorkflowStateBadge state={row.original.state} />,
      },
      {
        accessorKey: "created_at",
        header: "Created",
        cell: ({ getValue }) => {
          const v = getValue<number>();
          return (
            <span className="text-xs text-[var(--fg-muted)]" title={formatAbsolute(v)}>
              {formatRelative(v)}
            </span>
          );
        },
      },
      {
        accessorKey: "completed_at",
        header: "Completed",
        cell: ({ getValue }) => {
          const v = getValue<number | null>();
          if (v === null) return <span className="text-xs text-[var(--fg-muted)]">—</span>;
          return (
            <span className="text-xs text-[var(--fg-muted)]" title={formatAbsolute(v)}>
              {formatRelative(v)}
            </span>
          );
        },
      },
      {
        accessorKey: "error",
        header: "Error",
        cell: ({ getValue }) => {
          const v = getValue<string | null>();
          if (!v) return <span className="text-xs text-[var(--fg-muted)]">—</span>;
          return (
            <span className="truncate text-xs text-danger" title={v}>
              {v.slice(0, 60)}
              {v.length > 60 ? "…" : ""}
            </span>
          );
        },
      },
    ],
    [],
  );

  if (loading) return <TableSkeleton />;
  if (error) return <ErrorState onRetry={onRetry} />;
  if (!runs || runs.length === 0) {
    return <EmptyState title="No workflow runs" description="Submit a workflow to see it here." />;
  }

  return (
    <DataTable
      columns={columns}
      data={runs}
      onRowClick={(row) => navigate({ to: "/workflows/$runId", params: { runId: row.id } })}
    />
  );
}
