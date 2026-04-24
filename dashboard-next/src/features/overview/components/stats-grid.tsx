import { CheckCircle2, Clock, Pause, Play, Skull } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/ui/stat-card";
import type { QueueStats } from "@/lib/api-types";
import { formatCount } from "@/lib/number";

interface StatsGridProps {
  stats: QueueStats | undefined;
  pausedCount: number | undefined;
  loading?: boolean;
}

export function StatsGrid({ stats, pausedCount, loading }: StatsGridProps) {
  const failedTotal = (stats?.failed ?? 0) + (stats?.dead ?? 0);
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
