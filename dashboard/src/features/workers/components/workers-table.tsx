import type { ColumnDef } from "@tanstack/react-table";
import { Server } from "lucide-react";
import { useMemo } from "react";
import { Badge, DataTable, EmptyState, ErrorState, TableSkeleton } from "@/components/ui";
import type { Worker } from "@/lib/api-types";
import { cn } from "@/lib/cn";
import { formatRelative } from "@/lib/time";

const STALE_AFTER_MS = 30_000;

interface WorkersTableProps {
  workers: Worker[] | undefined;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
}

export function WorkersTable({ workers, loading, error, onRetry }: WorkersTableProps) {
  const columns = useMemo<ColumnDef<Worker>[]>(
    () => [
      {
        accessorKey: "worker_id",
        header: "Worker",
        cell: ({ getValue }) => (
          <span className="font-mono text-xs text-[var(--fg)]">{getValue<string>()}</span>
        ),
      },
      {
        accessorKey: "queues",
        header: "Queues",
        cell: ({ getValue }) => {
          const raw = getValue<string>();
          const parts = raw
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          return (
            <div className="flex flex-wrap gap-1">
              {parts.map((q) => (
                <Badge key={q} tone="neutral">
                  {q}
                </Badge>
              ))}
            </div>
          );
        },
      },
      {
        accessorKey: "last_heartbeat",
        header: "Heartbeat",
        cell: ({ getValue }) => {
          const ts = getValue<number>();
          const stale = Date.now() - ts > STALE_AFTER_MS;
          return (
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "size-2 rounded-full",
                  stale ? "bg-warning" : "bg-success animate-pulse",
                )}
                aria-hidden
              />
              <span className="text-xs text-[var(--fg-muted)]">{formatRelative(ts)}</span>
            </div>
          );
        },
      },
      {
        accessorKey: "registered_at",
        header: "Registered",
        cell: ({ getValue }) => (
          <span className="text-xs text-[var(--fg-muted)]">
            {formatRelative(getValue<number>())}
          </span>
        ),
      },
      {
        accessorKey: "tags",
        header: "Tags",
        cell: ({ getValue }) => {
          const tags = getValue<string | null>();
          if (!tags) return <span className="text-[var(--fg-subtle)]">—</span>;
          return <span className="text-xs text-[var(--fg-muted)]">{tags}</span>;
        },
      },
    ],
    [],
  );

  if (error) {
    return (
      <ErrorState title="Couldn't load workers" description={error.message} onRetry={onRetry} />
    );
  }

  if (loading && !workers) {
    return <TableSkeleton rows={4} columns={["w-32", "w-40", "w-24", "w-24", "w-20"]} />;
  }

  if (!workers || workers.length === 0) {
    return (
      <EmptyState
        icon={Server}
        title="No active workers"
        description="Workers register when you call q.start() or run taskito worker."
      />
    );
  }

  return <DataTable columns={columns} data={workers} rowKey={(w) => w.worker_id} />;
}
