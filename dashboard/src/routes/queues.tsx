import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout";
import { QueuesTable, usePausedQueues, useQueueStats } from "@/features/queues";

export const Route = createFileRoute("/queues")({
  component: QueuesPage,
});

function QueuesPage() {
  const stats = useQueueStats();
  const paused = usePausedQueues();

  return (
    <>
      <PageHeader
        title="Queues"
        description="Inspect throughput and pause or resume traffic per queue."
      />
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
