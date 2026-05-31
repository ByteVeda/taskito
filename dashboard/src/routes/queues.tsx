import { createFileRoute } from "@tanstack/react-router";
import { Clock, ListTree, Pause } from "lucide-react";
import { PageHeader } from "@/components/layout";
import { StatCard } from "@/components/ui";
import {
  pausedQueuesQuery,
  QueuesTable,
  queueStatsQuery,
  usePausedQueues,
  useQueueStats,
} from "@/features/queues";
import { formatCount } from "@/lib/number";

export const Route = createFileRoute("/queues")({
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(queueStatsQuery()),
      queryClient.ensureQueryData(pausedQueuesQuery()),
    ]),
  component: QueuesPage,
});

function QueuesPage() {
  const stats = useQueueStats();
  const paused = usePausedQueues();

  const queueNames = stats.data ? Object.keys(stats.data) : [];
  const totalQueues = queueNames.length;
  const pausedCount = paused.data?.length ?? 0;
  const totalPending = stats.data
    ? Object.values(stats.data).reduce((sum, s) => sum + (s.pending ?? 0), 0)
    : 0;

  return (
    <div className="flex flex-col gap-[var(--page-gap)]">
      <PageHeader
        eyebrow="Infrastructure"
        title="Queues"
        description="Inspect throughput and pause or resume traffic per queue."
      />
      <div className="grid gap-[var(--gap)] grid-cols-[repeat(auto-fit,minmax(186px,1fr))]">
        <StatCard
          label="Queues"
          tone="neutral"
          icon={<ListTree />}
          value={formatCount(totalQueues)}
        />
        <StatCard
          label="Total pending"
          tone="info"
          icon={<Clock />}
          value={formatCount(totalPending)}
        />
        <StatCard
          label="Paused"
          tone="warning"
          icon={<Pause />}
          value={formatCount(pausedCount)}
          hint="not pulling work"
        />
      </div>
      <QueuesTable
        stats={stats.data}
        paused={paused.data}
        loading={stats.isLoading || paused.isLoading}
        error={stats.error ?? paused.error}
        onRetry={() => {
          stats.refetch();
          paused.refetch();
        }}
      />
    </div>
  );
}
