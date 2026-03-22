import type { QueueStats } from "../../api";
import { StatCard } from "./stat-card";

interface StatsGridProps {
  stats: QueueStats;
}

const STAT_KEYS: (keyof QueueStats)[] = [
  "pending",
  "running",
  "completed",
  "failed",
  "dead",
  "cancelled",
];

export function StatsGrid({ stats }: StatsGridProps) {
  return (
    <div class="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4 mb-8">
      {STAT_KEYS.map((key) => (
        <StatCard key={key} label={key} value={stats[key] ?? 0} />
      ))}
    </div>
  );
}
