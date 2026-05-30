import type { ColumnDef } from "@tanstack/react-table";
import { Activity } from "lucide-react";
import { useMemo } from "react";
import { Badge, DataTable, EmptyState, ErrorState, TableSkeleton } from "@/components/ui";
import type { ResourceStatus } from "@/lib/api-types";
import { resourceTone } from "@/lib/status";
import { formatDuration } from "@/lib/time";

interface ResourcesTableProps {
  resources: ResourceStatus[] | undefined;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
}

export function ResourcesTable({ resources, loading, error, onRetry }: ResourcesTableProps) {
  const columns = useMemo<ColumnDef<ResourceStatus>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Resource",
        cell: ({ getValue }) => (
          <span className="font-medium text-[var(--fg)]">{getValue<string>()}</span>
        ),
      },
      {
        accessorKey: "scope",
        header: "Scope",
        cell: ({ getValue }) => (
          <span className="text-xs uppercase tracking-wider text-[var(--fg-subtle)]">
            {getValue<string>()}
          </span>
        ),
      },
      {
        accessorKey: "health",
        header: "Health",
        cell: ({ getValue }) => {
          const health = getValue<string>();
          return <Badge tone={resourceTone(health)}>{health}</Badge>;
        },
      },
      {
        accessorKey: "init_duration_ms",
        header: "Init",
        cell: ({ getValue }) => (
          <span className="text-xs tabular-nums text-[var(--fg-muted)]">
            {formatDuration(getValue<number>())}
          </span>
        ),
      },
      {
        accessorKey: "recreations",
        header: "Recreations",
        cell: ({ getValue }) => {
          const n = getValue<number>();
          return (
            <span className={`tabular-nums ${n > 0 ? "text-warning" : "text-[var(--fg-muted)]"}`}>
              {n}
            </span>
          );
        },
      },
      {
        id: "pool",
        header: "Pool",
        cell: ({ row }) => {
          const p = row.original.pool;
          if (!p) return <span className="text-[var(--fg-subtle)]">—</span>;
          return (
            <span className="text-xs tabular-nums text-[var(--fg-muted)]">
              {p.active}/{p.size} active · {p.idle} idle
              {p.total_timeouts > 0 ? (
                <span className="ml-1 text-danger">· {p.total_timeouts} timeouts</span>
              ) : null}
            </span>
          );
        },
      },
      {
        accessorKey: "depends_on",
        header: "Depends on",
        cell: ({ getValue }) => {
          const deps = getValue<string[]>();
          if (!deps || deps.length === 0) {
            return <span className="text-[var(--fg-subtle)]">—</span>;
          }
          return (
            <div className="flex flex-wrap gap-1">
              {deps.map((d) => (
                <Badge key={d} tone="neutral">
                  {d}
                </Badge>
              ))}
            </div>
          );
        },
      },
    ],
    [],
  );

  if (error) {
    return (
      <ErrorState title="Couldn't load resources" description={error.message} onRetry={onRetry} />
    );
  }

  if (loading && !resources) {
    return (
      <TableSkeleton rows={4} columns={["w-32", "w-16", "w-16", "w-16", "w-16", "w-40", "w-24"]} />
    );
  }

  if (!resources || resources.length === 0) {
    return (
      <EmptyState
        icon={Activity}
        title="No resources registered"
        description="Register shared infrastructure via @queue.worker_resource()."
      />
    );
  }

  return <DataTable columns={columns} data={resources} rowKey={(r) => r.name} />;
}
