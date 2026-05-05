import { createFileRoute } from "@tanstack/react-router";
import { ListTree, Pause, ShieldCheck } from "lucide-react";
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
    <>
      <PageHeader
        title="Queues"
        description="Inspect throughput and pause or resume traffic per queue."
      />
      <div className="mb-4 grid gap-3 grid-cols-[repeat(auto-fit,minmax(180px,1fr))]">
        <StatCard
          label="Queues"
          tone="neutral"
          icon={<ListTree className="size-4" />}
          value={formatCount(totalQueues)}
        />
        <StatCard
          label="Pending"
          tone="info"
          icon={<ShieldCheck className="size-4" />}
          value={formatCount(totalPending)}
        />
        <StatCard
          label="Paused"
          tone="warning"
          icon={<Pause className="size-4" />}
          value={formatCount(pausedCount)}
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
    </>
  );
}
