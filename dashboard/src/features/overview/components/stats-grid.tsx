import { CheckCircle2, Clock, Pause, Play, Skull } from "lucide-react";
import { ErrorState, Skeleton, StatCard } from "@/components/ui";
import { computeTrend } from "@/components/ui/stat-card-trend";
import type { QueueStats, TimeseriesBucket } from "@/lib/api-types";
import { formatCount } from "@/lib/number";
import { MiniSparkline } from "./mini-sparkline";

interface StatsGridProps {
  stats: QueueStats | undefined;
  pausedCount: number | undefined;
  throughput?: TimeseriesBucket[];
  loading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
}

/**
 * Split the throughput buckets in half to compare the recent window against
 * the prior window of equal length. Returns null when there's not enough data
 * for a meaningful comparison.
 */
function compareWindows(
  buckets: TimeseriesBucket[] | undefined,
  field: "success" | "failure",
): { current: number; previous: number } | null {
  if (!buckets || buckets.length < 4) return null;
  const mid = Math.floor(buckets.length / 2);
  const previous = buckets.slice(0, mid).reduce((sum, b) => sum + b[field], 0);
  const current = buckets.slice(mid).reduce((sum, b) => sum + b[field], 0);
  return { current, previous };
}

export function StatsGrid({
  stats,
  pausedCount,
  throughput,
  loading,
  error,
  onRetry,
}: StatsGridProps) {
  if (error) {
    return (
      <ErrorState title="Couldn't load queue stats" description={error.message} onRetry={onRetry} />
    );
  }
  const failedTotal = (stats?.failed ?? 0) + (stats?.dead ?? 0);

  const completedWindow = compareWindows(throughput, "success");
  const failedWindow = compareWindows(throughput, "failure");
  const completedTrend = completedWindow
    ? computeTrend(completedWindow.current, completedWindow.previous, { upIsGood: true })
    : null;
  const failedTrend = failedWindow
    ? computeTrend(failedWindow.current, failedWindow.previous, { upIsGood: false })
    : null;

  const successSpark = (throughput ?? []).map((b) => b.success);
  const failureSpark = (throughput ?? []).map((b) => b.failure);

  return (
    <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(180px,1fr))]">
      <StatCard
        label="Pending"
        tone="neutral"
        icon={<Clock className="size-4" />}
        value={loading ? <Skeleton className="h-7 w-16" /> : formatCount(stats?.pending ?? 0)}
      />
      <StatCard
        label="Running"
        tone="info"
        icon={<Play className="size-4" />}
        value={loading ? <Skeleton className="h-7 w-16" /> : formatCount(stats?.running ?? 0)}
      />
      <StatCard
        label="Completed"
        tone="success"
        icon={<CheckCircle2 className="size-4" />}
        value={loading ? <Skeleton className="h-7 w-16" /> : formatCount(stats?.completed ?? 0)}
        trend={completedTrend ?? undefined}
        sparkline={
          successSpark.length > 1 ? <MiniSparkline values={successSpark} tone="success" /> : null
        }
      />
      <StatCard
        label="Failed / dead"
        tone="danger"
        icon={<Skull className="size-4" />}
        value={loading ? <Skeleton className="h-7 w-16" /> : formatCount(failedTotal)}
        hint={
          stats
            ? `${formatCount(stats.dead)} dead · ${formatCount(stats.cancelled)} cancelled`
            : undefined
        }
        trend={failedTrend ?? undefined}
        sparkline={
          failureSpark.length > 1 ? <MiniSparkline values={failureSpark} tone="danger" /> : null
        }
      />
      <StatCard
        label="Paused queues"
        tone="warning"
        icon={<Pause className="size-4" />}
        value={
          loading || pausedCount == null ? (
            <Skeleton className="h-7 w-8" />
          ) : (
            formatCount(pausedCount)
          )
        }
      />
    </div>
  );
}
