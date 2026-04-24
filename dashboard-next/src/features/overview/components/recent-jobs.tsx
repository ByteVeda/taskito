import { Link, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import type { Job } from "@/lib/api-types";
import { JOB_STATUS_LABEL, JOB_STATUS_TONE } from "@/lib/status";
import { formatRelative } from "@/lib/time";

interface RecentJobsProps {
  jobs: Job[] | undefined;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
}

export function RecentJobs({ jobs, loading, error, onRetry }: RecentJobsProps) {
  const navigate = useNavigate();

  const columns = useMemo<ColumnDef<Job>[]>(
    () => [
      {
        accessorKey: "id",
        header: "Job",
        cell: ({ row }) => (
          <Link
            to="/jobs/$id"
            params={{ id: row.original.id }}
            className="font-mono text-xs text-accent hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {row.original.id.slice(0, 8)}…
          </Link>
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
        accessorKey: "created_at",
        header: "Created",
        cell: ({ getValue }) => (
          <span className="text-xs tabular-nums text-[var(--fg-muted)]">
            {formatRelative(getValue<number>() * 1000)}
          </span>
        ),
      },
    ],
    [],
  );

  if (error) {
    return <ErrorState title="Couldn't load jobs" description={error.message} onRetry={onRetry} />;
  }

  if (loading && !jobs) {
    return <Skeleton className="h-60 w-full" />;
  }

  return (
    <DataTable
      columns={columns}
      data={jobs ?? []}
      rowKey={(j) => j.id}
      empty="No jobs yet"
      onRowClick={(job) => navigate({ to: "/jobs/$id", params: { id: job.id } })}
    />
  );
}
