import type { ColumnDef } from "@tanstack/react-table";
import { ListFilter } from "lucide-react";
import { useMemo } from "react";
import { DataTable, EmptyState, ErrorState, TableSkeleton } from "@/components/ui";
import type { InterceptionStats } from "@/lib/api-types";
import { formatCount } from "@/lib/number";

interface Row {
  strategy: string;
  count: number;
  share: number;
}

interface InterceptionTableProps {
  stats: InterceptionStats | undefined;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
}

const STRATEGY_LABEL: Record<string, string> = {
  pass: "Pass",
  convert: "Convert",
  proxy: "Proxy",
  redirect: "Redirect",
  reject: "Reject",
};

export function InterceptionTable({ stats, loading, error, onRetry }: InterceptionTableProps) {
  const rows = useMemo<Row[]>(() => {
    if (!stats?.strategy_counts) return [];
    const total = Object.values(stats.strategy_counts).reduce((sum, n) => sum + n, 0);
    return Object.entries(stats.strategy_counts)
      .map(([strategy, count]) => ({
        strategy,
        count,
        share: total > 0 ? count / total : 0,
      }))
      .filter((r) => r.count > 0)
      .sort((a, b) => b.count - a.count);
  }, [stats]);

  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      {
        accessorKey: "strategy",
        header: "Strategy",
        cell: ({ getValue }) => {
          const key = getValue<string>();
          return <span className="font-medium text-[var(--fg)]">{STRATEGY_LABEL[key] ?? key}</span>;
        },
      },
      {
        accessorKey: "count",
        header: "Count",
        cell: ({ getValue }) => (
          <span className="tabular-nums">{formatCount(getValue<number>())}</span>
        ),
      },
      {
        accessorKey: "share",
        header: "Share",
        cell: ({ getValue }) => (
          <span className="tabular-nums text-[var(--fg-muted)]">
            {(getValue<number>() * 100).toFixed(1)}%
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
  if (loading && !stats) {
    return <TableSkeleton rows={4} columns={["w-28", "w-16", "w-16"]} />;
  }
  if (!stats || stats.total_intercepts === 0) {
    return (
      <EmptyState
        icon={ListFilter}
        title="No interceptions recorded"
        description="Strategy stats appear once arguments hit interception rules."
      />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-[var(--fg-muted)]">
        <span>
          <span className="text-[var(--fg-subtle)]">Total intercepts:</span>{" "}
          <span className="tabular-nums text-[var(--fg)]">
            {formatCount(stats.total_intercepts)}
          </span>
        </span>
        <span>
          <span className="text-[var(--fg-subtle)]">Avg duration:</span>{" "}
          <span className="tabular-nums text-[var(--fg)]">
            {stats.avg_duration_ms.toFixed(2)}ms
          </span>
        </span>
        <span>
          <span className="text-[var(--fg-subtle)]">Max depth:</span>{" "}
          <span className="tabular-nums text-[var(--fg)]">{stats.max_depth_reached}</span>
        </span>
      </div>
      <DataTable
        columns={columns}
        data={rows}
        rowKey={(r) => r.strategy}
        empty={
          <EmptyState
            icon={ListFilter}
            title="No strategy hits yet"
            description="Strategy counts populate as arguments are walked."
          />
        }
      />
    </div>
  );
}
