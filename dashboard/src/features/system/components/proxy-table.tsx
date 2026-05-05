import type { ColumnDef } from "@tanstack/react-table";
import { Shuffle } from "lucide-react";
import { useMemo } from "react";
import { DataTable, EmptyState, ErrorState, TableSkeleton } from "@/components/ui";
import type { ProxyHandlerStats, ProxyStats } from "@/lib/api-types";
import { formatCount } from "@/lib/number";

interface ProxyTableProps {
  stats: ProxyStats | undefined;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
}

export function ProxyTable({ stats, loading, error, onRetry }: ProxyTableProps) {
  const rows = useMemo<ProxyHandlerStats[]>(() => {
    if (!stats) return [];
    return [...stats].sort((a, b) => b.total_reconstructions - a.total_reconstructions);
  }, [stats]);

  const columns = useMemo<ColumnDef<ProxyHandlerStats>[]>(
    () => [
      {
        accessorKey: "handler",
        header: "Handler",
        cell: ({ getValue }) => (
          <span className="font-medium text-[var(--fg)]">{getValue<string>()}</span>
        ),
      },
      {
        accessorKey: "total_reconstructions",
        header: "Reconstructions",
        cell: ({ getValue }) => (
          <span className="tabular-nums">{formatCount(getValue<number>())}</span>
        ),
      },
      {
        accessorKey: "avg_duration_ms",
        header: "Avg",
        cell: ({ getValue }) => (
          <span className="tabular-nums text-[var(--fg-muted)]">
            {getValue<number>().toFixed(2)}ms
          </span>
        ),
      },
      {
        accessorKey: "p95_duration_ms",
        header: "p95",
        cell: ({ getValue }) => (
          <span className="tabular-nums text-[var(--fg-muted)]">
            {getValue<number>().toFixed(2)}ms
          </span>
        ),
      },
      {
        accessorKey: "total_errors",
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
    return <TableSkeleton rows={5} columns={["w-28", "w-24", "w-16", "w-16", "w-12"]} />;
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
