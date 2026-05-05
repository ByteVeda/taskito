import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout";
import { Separator } from "@/components/ui";
import {
  pausedQueuesQuery,
  QueueBreakdown,
  queueStatsQuery,
  RecentJobs,
  recentJobsQuery,
  StatsGrid,
  statsQuery,
  ThroughputSparkline,
  throughputQuery,
  usePausedQueues,
  useQueueStats,
  useRecentJobs,
  useStats,
  useThroughput,
} from "@/features/overview";

export const Route = createFileRoute("/")({
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(statsQuery()),
      queryClient.ensureQueryData(queueStatsQuery()),
      queryClient.ensureQueryData(pausedQueuesQuery()),
      queryClient.ensureQueryData(recentJobsQuery(10)),
      queryClient.ensureQueryData(throughputQuery(60, 3600)),
    ]),
  component: OverviewPage,
});

function OverviewPage() {
  const stats = useStats();
  const queueStats = useQueueStats();
  const paused = usePausedQueues();
  const jobs = useRecentJobs(10);
  const throughput = useThroughput(60, 3600);

  return (
    <>
      <PageHeader
        eyebrow="Dashboard"
        title="Overview"
        description="A live pulse on your queues, jobs, and workers."
      />

      <div className="flex flex-col gap-6">
        <div className="animate-slide-up" style={{ animationDelay: "0ms" }}>
          <StatsGrid
            stats={stats.data}
            pausedCount={paused.data?.length}
            throughput={throughput.data}
            loading={stats.isLoading}
            error={stats.error}
            onRetry={() => stats.refetch()}
          />
        </div>

        <div className="animate-slide-up" style={{ animationDelay: "60ms" }}>
          <ThroughputSparkline
            buckets={throughput.data}
            loading={throughput.isLoading}
            error={throughput.error}
            onRetry={() => throughput.refetch()}
          />
        </div>

        <Separator />

        <section
          className="flex flex-col gap-3 animate-slide-up"
          style={{ animationDelay: "120ms" }}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-tight text-[var(--fg)]">Queues</h2>
          </div>
          <QueueBreakdown
            queueStats={queueStats.data}
            paused={paused.data}
            loading={queueStats.isLoading}
            error={queueStats.error}
            onRetry={() => queueStats.refetch()}
          />
        </section>

        <section
          className="flex flex-col gap-3 animate-slide-up"
          style={{ animationDelay: "180ms" }}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-tight text-[var(--fg)]">Recent jobs</h2>
          </div>
          <RecentJobs
            jobs={jobs.data}
            loading={jobs.isLoading}
            error={jobs.error}
            onRetry={() => jobs.refetch()}
          />
        </section>
      </div>
    </>
  );
}
