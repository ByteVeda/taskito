import { Shuffle } from "lucide-react";
import { useMemo } from "react";
import {
  Card,
  EmptyState,
  ErrorState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeleton,
} from "@/components/ui";
import type { ProxyHandlerStats, ProxyStats } from "@/lib/api-types";
import { formatCount } from "@/lib/number";
import { formatDuration } from "@/lib/time";

interface ProxyTableProps {
  stats: ProxyStats | undefined;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
}

const NUM_CELL = "text-right font-mono text-[0.82rem] tabular-nums";

export function ProxyTable({ stats, loading, error, onRetry }: ProxyTableProps) {
  const rows = useMemo<ProxyHandlerStats[]>(() => {
    if (!stats) return [];
    return [...stats].sort((a, b) => b.total_reconstructions - a.total_reconstructions);
  }, [stats]);

  if (error) {
    return (
      <ErrorState title="Couldn't load proxy stats" description={error.message} onRetry={onRetry} />
    );
  }
  if (loading && rows.length === 0) {
    return (
      <TableSkeleton rows={5} columns={["w-28", "w-24", "w-16", "w-20", "w-16", "w-16", "w-16"]} />
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Shuffle}
        title="No proxy reconstructions recorded"
        description="Proxy stats appear once tasks reconstruct non-serializable arguments."
      />
    );
  }

  return (
    <Card className="overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Handler</TableHead>
            <TableHead className="text-right">Reconstructions</TableHead>
            <TableHead className="text-right">Errors</TableHead>
            <TableHead className="text-right">Checksum fails</TableHead>
            <TableHead className="text-right">Avg</TableHead>
            <TableHead className="text-right">p95</TableHead>
            <TableHead className="text-right">Max</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((p) => (
            <TableRow key={p.handler}>
              <TableCell className="font-mono text-[0.82rem] font-medium">{p.handler}</TableCell>
              <TableCell className={NUM_CELL}>{formatCount(p.total_reconstructions)}</TableCell>
              <TableCell
                className={`${NUM_CELL} ${
                  p.total_errors > 0 ? "text-danger" : "text-[var(--fg-muted)]"
                }`}
              >
                {p.total_errors}
              </TableCell>
              <TableCell
                className={`${NUM_CELL} ${
                  p.total_checksum_failures > 0 ? "text-warning" : "text-[var(--fg-muted)]"
                }`}
              >
                {p.total_checksum_failures}
              </TableCell>
              <TableCell className={`${NUM_CELL} text-[var(--fg-muted)]`}>
                {formatDuration(p.avg_duration_ms)}
              </TableCell>
              <TableCell className={`${NUM_CELL} text-[var(--fg-muted)]`}>
                {formatDuration(p.p95_duration_ms)}
              </TableCell>
              <TableCell className={`${NUM_CELL} text-[var(--fg-subtle)]`}>
                {formatDuration(p.max_duration_ms)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
