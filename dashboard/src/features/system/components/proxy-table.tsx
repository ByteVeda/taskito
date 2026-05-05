import type { ColumnDef } from "@tanstack/react-table";
import { Shuffle } from "lucide-react";
import { useMemo } from "react";
import { DataTable, EmptyState, ErrorState, TableSkeleton } from "@/components/ui";
import type { ProxyStats } from "@/lib/api-types";
import { formatCount } from "@/lib/number";

interface Row {
  handler: string;
  reconstructions: number;
  avg_ms: number;
  errors: number;
}

interface ProxyTableProps {
  stats: ProxyStats | undefined;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
}

export function ProxyTable({ stats, loading, error, onRetry }: ProxyTableProps) {
  const rows = useMemo<Row[]>(() => {
    if (!stats) return [];
    return Object.entries(stats)
      .map(([handler, v]) => ({ handler, ...v }))
      .sort((a, b) => b.reconstructions - a.reconstructions);
  }, [stats]);

  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      {
        accessorKey: "handler",
        header: "Handler",
        cell: ({ getValue }) => (
          <span className="font-medium text-[var(--fg)]">{getValue<string>()}</span>
        ),
      },
      {
        accessorKey: "reconstructions",
        header: "Reconstructions",
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
      {
        accessorKey: "errors",
        header: "Errors",
        cell: ({ getValue }) => {
          const n = getValue<number>();
          return (
            <span className={`tabular-nums ${n > 0 ? "text-danger" : "text-[var(--fg-muted)]"}`}>
              {n}
            </span>
          );
        },
      },
    ],
    [],
  );

  if (error) {
    return (
      <ErrorState title="Couldn't load proxy stats" description={error.message} onRetry={onRetry} />
    );
  }
  if (loading && rows.length === 0) {
    return <TableSkeleton rows={5} columns={["w-28", "w-24", "w-16", "w-12"]} />;
  }
  return (
    <DataTable
      columns={columns}
      data={rows}
      rowKey={(r) => r.handler}
      empty={
        <EmptyState
          icon={Shuffle}
          title="No proxy reconstructions recorded"
          description="Proxy stats appear once tasks reconstruct non-serializable arguments."
        />
      }
    />
  );
}
