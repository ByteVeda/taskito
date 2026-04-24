import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { DataTable } from "@/components/ui/data-table";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import type { InterceptionStats } from "@/lib/api-types";
import { formatCount } from "@/lib/number";

interface Row {
  strategy: string;
  count: number;
  avg_ms: number;
}

interface InterceptionTableProps {
  stats: InterceptionStats | undefined;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
}

export function InterceptionTable({ stats, loading, error, onRetry }: InterceptionTableProps) {
  const rows = useMemo<Row[]>(() => {
    if (!stats) return [];
    return Object.entries(stats)
      .map(([strategy, v]) => ({ strategy, ...v }))
      .sort((a, b) => b.count - a.count);
  }, [stats]);

  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      {
        accessorKey: "strategy",
        header: "Strategy",
        cell: ({ getValue }) => (
          <span className="font-medium text-[var(--fg)]">{getValue<string>()}</span>
        ),
      },
      {
        accessorKey: "count",
        header: "Count",
        cell: ({ getValue }) => (
          <span className="tabular-nums">{formatCount(getValue<number>())}</span>
        ),
      },
      {
        accessorKey: "avg_ms",
        header: "Avg",
        cell: ({ getValue }) => (
          <span className="tabular-nums text-[var(--fg-muted)]">
            {getValue<number>().toFixed(1)}ms
          </span>
        ),
      },
    ],
    [],
  );

  if (error) {
    return (
      <ErrorState
        title="Couldn't load interception stats"
        description={error.message}
        onRetry={onRetry}
      />
    );
  }
  if (loading && rows.length === 0) {
    return <Skeleton className="h-40 w-full" />;
  }
  return (
    <DataTable
      columns={columns}
      data={rows}
      rowKey={(r) => r.strategy}
      empty="No interceptions recorded"
    />
  );
}
