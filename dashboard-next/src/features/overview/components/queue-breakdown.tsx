import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { Badge, DataTable, ErrorState, Skeleton } from "@/components/ui";
import type { QueueStatsMap } from "@/lib/api-types";
import { formatCount } from "@/lib/number";

interface Row {
  name: string;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  dead: number;
  failedTotal: number;
  paused: boolean;
}

interface QueueBreakdownProps {
  queueStats: QueueStatsMap | undefined;
  paused: string[] | undefined;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
}

export function QueueBreakdown({
  queueStats,
  paused,
  loading,
  error,
  onRetry,
}: QueueBreakdownProps) {
  const rows = useMemo<Row[]>(() => {
    if (!queueStats) return [];
    const pausedSet = new Set(paused ?? []);
    return Object.entries(queueStats)
      .map(([name, s]) => {
        const failed = s.failed ?? 0;
        const dead = s.dead ?? 0;
        return {
          name,
          pending: s.pending ?? 0,
          running: s.running ?? 0,
          completed: s.completed ?? 0,
          failed,
          dead,
          failedTotal: failed + dead,
          paused: pausedSet.has(name),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [queueStats, paused]);

  const columns = useMemo<ColumnDef<Row>[]>(
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
        accessorKey: "failedTotal",
        header: "Failed / dead",
        cell: ({ getValue }) => {
          const total = getValue<number>();
          return (
            <span
              className={`tabular-nums ${total > 0 ? "text-danger" : "text-[var(--fg-muted)]"}`}
            >
              {formatCount(total)}
            </span>
          );
        },
      },
    ],
    [],
  );

  if (error) {
    return (
      <ErrorState title="Couldn't load queues" description={error.message} onRetry={onRetry} />
    );
  }

  if (loading && rows.length === 0) {
    return <Skeleton className="h-48 w-full" />;
  }

  return (
    <DataTable
      columns={columns}
      data={rows}
      rowKey={(r) => r.name}
      empty="No queues with activity yet"
    />
  );
}
