import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { DataTable, EmptyState, ErrorState, TableSkeleton } from "@/components/ui";
import type { MetricsResponse, TaskMetrics } from "@/lib/api-types";
import { formatCount, formatPercent } from "@/lib/number";

interface Row extends TaskMetrics {
  task: string;
  successRate: number;
}

interface MetricsTableProps {
  metrics: MetricsResponse | undefined;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
}

export function MetricsTable({ metrics, loading, error, onRetry }: MetricsTableProps) {
  const rows = useMemo<Row[]>(() => {
    if (!metrics) return [];
    return Object.entries(metrics)
      .map(([task, m]) => ({
        ...m,
        task,
        successRate: m.count > 0 ? m.success_count / m.count : 0,
      }))
      .sort((a, b) => b.count - a.count);
  }, [metrics]);

  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      {
        id: "task",
        accessorKey: "task",
        header: "Task",
        cell: ({ getValue }) => (
          <span className="font-medium text-[var(--fg)]">{getValue<string>()}</span>
        ),
      },
      {
        id: "volume",
        header: () => <GroupHeader>Volume</GroupHeader>,
        columns: [
          {
            accessorKey: "count",
            header: "Runs",
            cell: ({ getValue }) => (
              <span className="tabular-nums">{formatCount(getValue<number>())}</span>
            ),
          },
          {
            accessorKey: "successRate",
            header: "Success",
            cell: ({ row }) => {
              const rate = row.original.successRate;
              const tone =
                rate >= 0.99 ? "text-success" : rate >= 0.9 ? "text-warning" : "text-danger";
              return <span className={`tabular-nums ${tone}`}>{formatPercent(rate, 1)}</span>;
            },
          },
          {
            accessorKey: "failure_count",
            header: "Failures",
            cell: ({ getValue }) => {
              const n = getValue<number>();
              return (
                <span
                  className={`tabular-nums ${n > 0 ? "text-danger" : "text-[var(--fg-muted)]"}`}
                >
                  {formatCount(n)}
                </span>
              );
            },
          },
        ],
      },
      {
        id: "latency",
        header: () => <GroupHeader>Latency</GroupHeader>,
        columns: [
          {
            accessorKey: "p50_ms",
            header: "p50",
            cell: ({ getValue }) => <Ms value={getValue<number>()} />,
          },
          {
            accessorKey: "p95_ms",
            header: "p95",
            cell: ({ getValue }) => <Ms value={getValue<number>()} />,
          },
          {
            accessorKey: "p99_ms",
            header: "p99",
            cell: ({ getValue }) => <Ms value={getValue<number>()} />,
          },
          {
            accessorKey: "avg_ms",
            header: "avg",
            cell: ({ getValue }) => <Ms value={getValue<number>()} />,
          },
          {
            accessorKey: "max_ms",
            header: "max",
            cell: ({ getValue }) => <Ms value={getValue<number>()} />,
          },
        ],
      },
    ],
    [],
  );

  if (error) {
    return (
      <ErrorState title="Couldn't load metrics" description={error.message} onRetry={onRetry} />
    );
  }

  if (loading && rows.length === 0) {
    return (
      <TableSkeleton
        rows={8}
        columns={["w-32", "w-16", "w-16", "w-16", "w-16", "w-16", "w-16", "w-16", "w-16"]}
      />
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No task activity in this window"
        description="Metrics appear once tasks start completing."
      />
    );
  }

  return <DataTable columns={columns} data={rows} rowKey={(r) => r.task} />;
}

function GroupHeader({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-subtle)]">
      {children}
    </span>
  );
}

function Ms({ value }: { value: number | null | undefined }) {
  if (value == null || !Number.isFinite(value)) {
    return <span className="tabular-nums text-[var(--fg-subtle)]">—</span>;
  }
  return <span className="tabular-nums text-[var(--fg-muted)]">{`${value.toFixed(1)}ms`}</span>;
}
