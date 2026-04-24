import type { ColumnDef } from "@tanstack/react-table";
import { CircuitBoard } from "lucide-react";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import type { CircuitBreaker } from "@/lib/api-types";
import { CIRCUIT_LABEL, CIRCUIT_TONE } from "@/lib/status";
import { formatDuration } from "@/lib/time";

interface CircuitBreakersTableProps {
  breakers: CircuitBreaker[] | undefined;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
}

export function CircuitBreakersTable({
  breakers,
  loading,
  error,
  onRetry,
}: CircuitBreakersTableProps) {
  const columns = useMemo<ColumnDef<CircuitBreaker>[]>(
    () => [
      {
        accessorKey: "task_name",
        header: "Task",
        cell: ({ getValue }) => (
          <span className="font-medium text-[var(--fg)]">{getValue<string>()}</span>
        ),
      },
      {
        accessorKey: "state",
        header: "State",
        cell: ({ row }) => (
          <Badge tone={CIRCUIT_TONE[row.original.state]}>{CIRCUIT_LABEL[row.original.state]}</Badge>
        ),
      },
      {
        accessorKey: "failure_count",
        header: "Failures / Threshold",
        cell: ({ row }) => {
          const { failure_count, threshold } = row.original;
          const over = failure_count >= threshold;
          return (
            <span className={`tabular-nums ${over ? "text-danger" : "text-[var(--fg-muted)]"}`}>
              {failure_count} / {threshold}
            </span>
          );
        },
      },
      {
        accessorKey: "window_ms",
        header: "Window",
        cell: ({ getValue }) => (
          <span className="text-xs tabular-nums text-[var(--fg-muted)]">
            {formatDuration(getValue<number>())}
          </span>
        ),
      },
      {
        accessorKey: "cooldown_ms",
        header: "Cooldown",
        cell: ({ getValue }) => (
          <span className="text-xs tabular-nums text-[var(--fg-muted)]">
            {formatDuration(getValue<number>())}
          </span>
        ),
      },
      {
        accessorKey: "last_failure_at",
        header: "Last failure",
        cell: ({ getValue }) => {
          const v = getValue<number | null>();
          if (!v) return <span className="text-[var(--fg-subtle)]">—</span>;
          const ago = Math.round((Date.now() - v * 1000) / 1000);
          return (
            <span className="text-xs tabular-nums text-[var(--fg-muted)]">
              {ago < 60 ? `${ago}s ago` : `${Math.round(ago / 60)}m ago`}
            </span>
          );
        },
      },
    ],
    [],
  );

  if (error) {
    return (
      <ErrorState
        title="Couldn't load circuit breakers"
        description={error.message}
        onRetry={onRetry}
      />
    );
  }

  if (loading && !breakers) {
    return <Skeleton className="h-48 w-full" />;
  }

  if (!breakers || breakers.length === 0) {
    return (
      <EmptyState
        icon={CircuitBoard}
        title="No circuit breakers configured"
        description="Circuit breakers open when a task fails more than the threshold within a window."
      />
    );
  }

  return <DataTable columns={columns} data={breakers} rowKey={(b) => b.task_name} />;
}
