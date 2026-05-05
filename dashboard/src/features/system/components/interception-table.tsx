import type { ColumnDef } from "@tanstack/react-table";
import { ListFilter } from "lucide-react";
import { useMemo } from "react";
import { DataTable, EmptyState, ErrorState, TableSkeleton } from "@/components/ui";
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
    return <TableSkeleton rows={5} columns={["w-28", "w-16", "w-16"]} />;
  }
  return (
    <DataTable
      columns={columns}
      data={rows}
      rowKey={(r) => r.strategy}
      empty={
        <EmptyState
          icon={ListFilter}
          title="No interceptions recorded"
          description="Strategy stats appear once arguments hit interception rules."
        />
      }
    />
  );
}
