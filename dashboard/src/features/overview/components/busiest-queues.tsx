import { Box } from "lucide-react";
import { useMemo } from "react";
import {
  Badge,
  EmptyState,
  QueueBar,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui";
import type { QueueStatsMap } from "@/lib/api-types";
import { formatCount } from "@/lib/number";

interface BusiestQueuesProps {
  queueStats: QueueStatsMap | undefined;
  paused: string[] | undefined;
  loading: boolean;
}

/** The six queues with the most live work (running + pending), with a mix bar. */
export function BusiestQueues({ queueStats, paused, loading }: BusiestQueuesProps) {
  const rows = useMemo(() => {
    if (!queueStats) return [];
    const pausedSet = new Set(paused ?? []);
    return Object.entries(queueStats)
      .map(([name, s]) => ({
        name,
        pending: s.pending ?? 0,
        running: s.running ?? 0,
        failedTotal: (s.failed ?? 0) + (s.dead ?? 0),
        paused: pausedSet.has(name),
      }))
      .sort((a, b) => b.running + b.pending - (a.running + a.pending))
      .slice(0, 6);
  }, [queueStats, paused]);

  if (loading && rows.length === 0) return <Skeleton className="h-56 w-full" />;

  return (
    <div className="overflow-hidden rounded-[var(--card-radius)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--card-shadow)]">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Queue</TableHead>
            <TableHead className="w-[34%]">Mix</TableHead>
            <TableHead className="text-right">Pending</TableHead>
            <TableHead className="text-right">Running</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="h-32 p-0">
                <EmptyState
                  icon={Box}
                  title="No queues with activity yet"
                  description="Queues populate as jobs are enqueued."
                />
              </TableCell>
            </TableRow>
          ) : (
            rows.map((q) => (
              <TableRow key={q.name}>
                <TableCell>
                  <div className="flex items-center gap-2.5">
                    <span className="font-medium text-[var(--fg)]">{q.name}</span>
                    {q.paused ? <Badge tone="warning">Paused</Badge> : null}
                  </div>
                </TableCell>
                <TableCell>
                  <QueueBar pending={q.pending} running={q.running} failedTotal={q.failedTotal} />
                </TableCell>
                <TableCell className="text-right font-mono text-[0.82rem] tabular-nums">
                  {formatCount(q.pending)}
                </TableCell>
                <TableCell className="text-right font-mono text-[0.82rem] tabular-nums text-info">
                  {formatCount(q.running)}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
