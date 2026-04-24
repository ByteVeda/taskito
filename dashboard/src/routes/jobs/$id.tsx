import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout";
import {
  Badge,
  ErrorState,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui";
import {
  JobActions,
  JobDagTab,
  JobErrorsTab,
  JobLogsTab,
  JobOverviewTab,
  JobReplayTab,
  useJob,
  useJobDag,
  useJobErrors,
  useJobLogs,
  useReplayHistory,
} from "@/features/jobs";
import { JOB_STATUS_LABEL, JOB_STATUS_TONE } from "@/lib/status";

export const Route = createFileRoute("/jobs/$id")({
  component: JobDetailPage,
});

function JobDetailPage() {
  const { id } = Route.useParams();
  const job = useJob(id);
  const logs = useJobLogs(id);
  const errors = useJobErrors(id);
  const replays = useReplayHistory(id);
  const dag = useJobDag(id);

  if (job.isLoading && !job.data) {
    return (
      <>
        <PageHeader
          title="Loading job…"
          breadcrumbs={[{ label: "Jobs", to: "/jobs" }, { label: id }]}
        />
        <Skeleton className="h-96 w-full" />
      </>
    );
  }

  if (job.error || !job.data) {
    return (
      <>
        <PageHeader title="Job" breadcrumbs={[{ label: "Jobs", to: "/jobs" }, { label: id }]} />
        <ErrorState
          title="Couldn't load job"
          description={job.error?.message ?? "This job may have been purged."}
          onRetry={() => job.refetch()}
        />
      </>
    );
  }

  const data = job.data;
  const statusTone = JOB_STATUS_TONE[data.status];

  return (
    <>
      <PageHeader
        title={data.task_name}
        description={
          <span className="inline-flex items-center gap-2 font-mono text-xs text-[var(--fg-subtle)]">
            {data.id}
          </span>
        }
        breadcrumbs={[{ label: "Jobs", to: "/jobs" }, { label: data.id.slice(0, 8) }]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={statusTone}>{JOB_STATUS_LABEL[data.status]}</Badge>
            <JobActions job={data} />
          </div>
        }
      />

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
          <TabsTrigger value="errors">Errors</TabsTrigger>
          <TabsTrigger value="replays">Replays</TabsTrigger>
          <TabsTrigger value="dag">DAG</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <JobOverviewTab job={data} />
        </TabsContent>
        <TabsContent value="logs">
          <JobLogsTab
            logs={logs.data}
            loading={logs.isLoading}
            error={logs.error}
            onRetry={() => logs.refetch()}
          />
        </TabsContent>
        <TabsContent value="errors">
          <JobErrorsTab
            errors={errors.data}
            loading={errors.isLoading}
            error={errors.error}
            onRetry={() => errors.refetch()}
          />
        </TabsContent>
        <TabsContent value="replays">
          <JobReplayTab
            replays={replays.data}
            loading={replays.isLoading}
            error={replays.error}
            onRetry={() => replays.refetch()}
          />
        </TabsContent>
        <TabsContent value="dag">
          <JobDagTab
            dag={dag.data}
            loading={dag.isLoading}
            error={dag.error}
            onRetry={() => dag.refetch()}
          />
        </TabsContent>
      </Tabs>
    </>
  );
}
