import type { ColumnDef } from "@tanstack/react-table";
import { Box, Pause, Play } from "lucide-react";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import type { QueueStatsMap } from "@/lib/api-types";
import { formatCount } from "@/lib/number";
import { usePauseQueue, useResumeQueue } from "../hooks";

interface QueueRow {
  name: string;
  paused: boolean;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  dead: number;
}

interface QueuesTableProps {
  stats: QueueStatsMap | undefined;
  paused: string[] | undefined;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
}

export function QueuesTable({ stats, paused, loading, error, onRetry }: QueuesTableProps) {
  const pauseMutation = usePauseQueue();
  const resumeMutation = useResumeQueue();

  const rows = useMemo<QueueRow[]>(() => {
    if (!stats) return [];
    const pausedSet = new Set(paused ?? []);
    return Object.entries(stats)
      .map(([name, s]) => ({
        name,
        paused: pausedSet.has(name),
        pending: s.pending ?? 0,
        running: s.running ?? 0,
        completed: s.completed ?? 0,
        failed: s.failed ?? 0,
        dead: s.dead ?? 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [stats, paused]);

  const columns = useMemo<ColumnDef<QueueRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Queue",
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <span className="font-medium text-[var(--fg)]">{row.original.name}</span>
            {row.original.paused ? <Badge tone="warning">Paused</Badge> : null}
          </div>
        ),
      },
      {
        accessorKey: "pending",
        header: "Pending",
        cell: ({ getValue }) => (
          <span className="tabular-nums">{formatCount(getValue<number>())}</span>
        ),
      },
      {
        accessorKey: "running",
        header: "Running",
        cell: ({ getValue }) => (
          <span className="tabular-nums text-info">{formatCount(getValue<number>())}</span>
        ),
      },
      {
        accessorKey: "completed",
        header: "Completed",
        cell: ({ getValue }) => (
          <span className="tabular-nums text-[var(--fg-muted)]">
            {formatCount(getValue<number>())}
          </span>
        ),
      },
      {
        accessorKey: "failed",
        header: "Failed",
        cell: ({ row }) => {
          const total = row.original.failed + row.original.dead;
          return (
            <span
              className={`tabular-nums ${total > 0 ? "text-danger" : "text-[var(--fg-muted)]"}`}
            >
              {formatCount(total)}
            </span>
          );
        },
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const name = row.original.name;
          if (row.original.paused) {
            return (
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  resumeMutation.mutate(name);
                }}
                disabled={resumeMutation.isPending}
              >
                <Play aria-hidden /> Resume
              </Button>
            );
          }
          return (
            <Button
              variant="secondary"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                pauseMutation.mutate(name);
              }}
              disabled={pauseMutation.isPending}
            >
              <Pause aria-hidden /> Pause
            </Button>
          );
        },
      },
    ],
    [pauseMutation, resumeMutation],
  );

  if (error) {
    return (
      <ErrorState title="Couldn't load queues" description={error.message} onRetry={onRetry} />
    );
  }

  if (loading && rows.length === 0) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Box}
        title="No queues registered"
        description="Queues appear here once tasks are enqueued."
      />
    );
  }

  return <DataTable columns={columns} data={rows} rowKey={(r) => r.name} />;
}
