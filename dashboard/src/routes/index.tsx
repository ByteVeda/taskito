import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, RefreshCw } from "lucide-react";
import { PageHeader, SectionHeading } from "@/components/layout";
import { Badge, Button } from "@/components/ui";
import {
  BusiestQueues,
  Pulse,
  pausedQueuesQuery,
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
  WorkersCard,
} from "@/features/overview";
import { useWorkers, workersQuery } from "@/features/workers";
import { isWorkerStale } from "@/features/workers/utils";

export const Route = createFileRoute("/")({
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(statsQuery()),
      queryClient.ensureQueryData(queueStatsQuery()),
      queryClient.ensureQueryData(pausedQueuesQuery()),
      queryClient.ensureQueryData(recentJobsQuery(10)),
      queryClient.ensureQueryData(throughputQuery(60, 3600)),
      queryClient.ensureQueryData(workersQuery()),
    ]),
  component: OverviewPage,
});

function OverviewPage() {
  const stats = useStats();
  const queueStats = useQueueStats();
  const paused = usePausedQueues();
  const jobs = useRecentJobs(10);
  const throughput = useThroughput(60, 3600);
  const workers = useWorkers();

  const refreshAll = () => {
    stats.refetch();
    queueStats.refetch();
    paused.refetch();
    jobs.refetch();
    throughput.refetch();
    workers.refetch();
  };

  const onlineWorkers = (workers.data ?? []).filter((w) => !isWorkerStale(w)).length;

  return (
    <>
      <PageHeader
        eyebrow="Dashboard"
        title="Overview"
        description="A friendly, live pulse on everything your workers are chewing through."
        actions={
          <Button variant="outline" onClick={refreshAll}>
            <RefreshCw aria-hidden />
            Refresh
          </Button>
        }
      />

      <div className="flex flex-col gap-[var(--page-gap)]">
        <Pulse stats={stats.data} throughput={throughput.data} />

        <StatsGrid
          stats={stats.data}
          pausedCount={paused.data?.length}
          throughput={throughput.data}
          loading={stats.isLoading}
          error={stats.error}
          onRetry={() => stats.refetch()}
        />

        <ThroughputSparkline
          buckets={throughput.data}
          loading={throughput.isLoading}
          error={throughput.error}
          onRetry={() => throughput.refetch()}
        />

        <div className="grid gap-[var(--gap)] lg:grid-cols-[1.5fr_1fr]">
          <section>
            <SectionHeading
              title="Busiest queues"
              action={
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/queues">
                    View all
                    <ChevronRight aria-hidden />
                  </Link>
                </Button>
              }
            />
            <BusiestQueues
              queueStats={queueStats.data}
              paused={paused.data}
              loading={queueStats.isLoading}
            />
          </section>
          <section>
            <SectionHeading
              title="Workers"
              action={
                <Badge tone="success" dot>
                  {onlineWorkers} online
                </Badge>
              }
            />
            <WorkersCard workers={workers.data} loading={workers.isLoading} />
          </section>
        </div>

        <section>
          <SectionHeading
            title="Recent jobs"
            action={
              <Button variant="ghost" size="sm" asChild>
                <Link to="/jobs" search={{ page: 0, pageSize: 25 }}>
                  Open Jobs
                  <ChevronRight aria-hidden />
                </Link>
              </Button>
            }
          />
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
