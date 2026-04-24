import { useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import type { Job } from "@/lib/api-types";
import { JOB_STATUS_LABEL, JOB_STATUS_TONE } from "@/lib/status";
import { formatRelative } from "@/lib/time";

interface JobTableProps {
  jobs: Job[] | undefined;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
}

export function JobTable({ jobs, loading, error, onRetry }: JobTableProps) {
  const navigate = useNavigate();

  const columns = useMemo<ColumnDef<Job>[]>(
    () => [
      {
        accessorKey: "id",
        header: "Job",
        cell: ({ getValue }) => (
          <span className="font-mono text-xs text-accent">{getValue<string>().slice(0, 8)}…</span>
        ),
      },
      {
        accessorKey: "task_name",
        header: "Task",
        cell: ({ getValue }) => (
          <span className="truncate text-[var(--fg)]">{getValue<string>()}</span>
        ),
      },
      {
        accessorKey: "queue",
        header: "Queue",
        cell: ({ getValue }) => (
          <span className="text-xs text-[var(--fg-muted)]">{getValue<string>()}</span>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <Badge tone={JOB_STATUS_TONE[row.original.status]}>
            {JOB_STATUS_LABEL[row.original.status]}
          </Badge>
        ),
      },
      {
        accessorKey: "retry_count",
        header: "Retries",
        cell: ({ row }) => {
          const { retry_count, max_retries } = row.original;
          return (
            <span
              className={`tabular-nums ${retry_count > 0 ? "text-warning" : "text-[var(--fg-muted)]"}`}
            >
              {retry_count}
              {max_retries > 0 ? ` / ${max_retries}` : null}
            </span>
          );
        },
      },
      {
        accessorKey: "created_at",
        header: "Created",
        cell: ({ getValue }) => (
          <span className="text-xs tabular-nums text-[var(--fg-muted)]">
            {formatRelative(getValue<number>() * 1000)}
          </span>
        ),
      },
      {
        accessorKey: "error",
        header: "Error",
        cell: ({ getValue }) => {
          const err = getValue<string | null>();
          if (!err) return <span className="text-[var(--fg-subtle)]">—</span>;
          return (
            <span className="line-clamp-1 max-w-[320px] text-xs text-danger" title={err}>
              {err}
            </span>
          );
        },
      },
    ],
    [],
  );

  if (error) {
    return <ErrorState title="Couldn't load jobs" description={error.message} onRetry={onRetry} />;
  }

  if (loading && !jobs) {
    return <Skeleton className="h-96 w-full" />;
  }

  if (!jobs || jobs.length === 0) {
    return (
      <EmptyState
        title="No jobs match these filters"
        description="Try clearing a filter or widening the date range."
      />
    );
  }

  return (
    <DataTable
      columns={columns}
      data={jobs}
      rowKey={(j) => j.id}
      onRowClick={(job) => navigate({ to: "/jobs/$id", params: { id: job.id } })}
    />
  );
}
