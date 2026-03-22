import { FileText, RotateCcw } from "lucide-preact";
import { route } from "preact-router";
import {
  apiPost,
  type DagData,
  type Job,
  type JobError,
  type ReplayEntry,
  type TaskLog,
} from "../api";
import { DagViewer } from "../charts";
import {
  Badge,
  Button,
  type Column,
  DataTable,
  EmptyState,
  ErrorState,
  Loading,
  ProgressBar,
} from "../components/ui";
import { addToast, useApi } from "../hooks";
import { fmtTime, type RoutableProps, truncateId } from "../lib";

interface JobDetailProps extends RoutableProps {
  id?: string;
}

const ERROR_COLUMNS: Column<JobError>[] = [
  { header: "Attempt", accessor: "attempt" },
  { header: "Error", accessor: "error", className: "max-w-xs truncate" },
  { header: "Failed At", accessor: (e) => <span class="text-muted">{fmtTime(e.failed_at)}</span> },
];

const LOG_COLUMNS: Column<TaskLog>[] = [
  { header: "Time", accessor: (l) => <span class="text-muted">{fmtTime(l.logged_at)}</span> },
  {
    header: "Level",
    accessor: (l) => (
      <Badge
        status={l.level === "error" ? "failed" : l.level === "warning" ? "pending" : "complete"}
      />
    ),
  },
  { header: "Message", accessor: "message" },
  { header: "Extra", accessor: (l) => l.extra ?? "\u2014", className: "max-w-[200px] truncate" },
];

const REPLAY_COLUMNS: Column<ReplayEntry>[] = [
  {
    header: "Replay Job",
    accessor: (r) => (
      <a
        href={`/jobs/${r.replay_job_id}`}
        class="font-mono text-xs text-accent-light hover:underline"
      >
        {truncateId(r.replay_job_id)}
      </a>
    ),
  },
  {
    header: "Replayed At",
    accessor: (r) => <span class="text-muted">{fmtTime(r.replayed_at)}</span>,
  },
  {
    header: "Original Error",
    accessor: (r) => r.original_error ?? "\u2014",
    className: "max-w-[200px] truncate",
  },
  {
    header: "Replay Error",
    accessor: (r) => r.replay_error ?? "\u2014",
    className: "max-w-[200px] truncate",
  },
];

export function JobDetail({ id }: JobDetailProps) {
  const { data: job, loading, error, refetch } = useApi<Job>(`/api/jobs/${id}`);
  const { data: errors } = useApi<JobError[]>(`/api/jobs/${id}/errors`);
  const { data: logs } = useApi<TaskLog[]>(`/api/jobs/${id}/logs`);
  const { data: replayHistory } = useApi<ReplayEntry[]>(`/api/jobs/${id}/replay-history`);
  const { data: dag } = useApi<DagData>(`/api/jobs/${id}/dag`);

  if (error && !job) return <ErrorState message={error} onRetry={refetch} />;
  if (loading && !job) return <Loading />;
  if (!job) return <EmptyState message={`Job not found: ${id}`} />;

  const handleCancel = async () => {
    try {
      const res = await apiPost<{ cancelled: boolean }>(`/api/jobs/${id}/cancel`);
      addToast(
        res.cancelled ? "Job cancelled" : "Failed to cancel job",
        res.cancelled ? "success" : "error",
      );
      refetch();
    } catch {
      addToast("Failed to cancel job", "error");
    }
  };

  const handleReplay = async () => {
    try {
      const res = await apiPost<{ replay_job_id: string }>(`/api/jobs/${id}/replay`);
      addToast("Job replayed", "success");
      route(`/jobs/${res.replay_job_id}`);
    } catch {
      addToast("Failed to replay job", "error");
    }
  };

  // Determine accent color for the detail card border
  const borderColor: Record<string, string> = {
    pending: "border-t-warning",
    running: "border-t-info",
    complete: "border-t-success",
    failed: "border-t-danger",
    dead: "border-t-danger",
    cancelled: "border-t-muted",
  };

  return (
    <div>
      <div class="flex items-center gap-3 mb-6">
        <div class="p-2 rounded-lg dark:bg-surface-3 bg-slate-100">
          <FileText class="w-5 h-5 text-accent" strokeWidth={1.8} />
        </div>
        <div>
          <h1 class="text-lg font-semibold dark:text-white text-slate-900">
            Job <span class="font-mono text-accent-light">{truncateId(job.id)}</span>
          </h1>
          <p class="text-xs text-muted">{job.task_name}</p>
        </div>
      </div>

      <div
        class={`dark:bg-surface-2 bg-white rounded-xl shadow-sm dark:shadow-black/20 p-6 border dark:border-white/[0.06] border-slate-200 border-t-[3px] ${borderColor[job.status] ?? "border-t-muted"}`}
      >
        <div class="grid grid-cols-[140px_1fr] gap-x-6 gap-y-3 text-[13px]">
          <span class="text-muted font-medium">ID</span>
          <span class="font-mono text-xs break-all dark:text-gray-300 text-slate-600">
            {job.id}
          </span>
          <span class="text-muted font-medium">Status</span>
          <span>
            <Badge status={job.status} />
          </span>
          <span class="text-muted font-medium">Task</span>
          <span class="font-medium">{job.task_name}</span>
          <span class="text-muted font-medium">Queue</span>
          <span>{job.queue}</span>
          <span class="text-muted font-medium">Priority</span>
          <span>{job.priority}</span>
          <span class="text-muted font-medium">Progress</span>
          <span>
            <ProgressBar progress={job.progress} />
          </span>
          <span class="text-muted font-medium">Retries</span>
          <span class={job.retry_count > 0 ? "text-warning" : ""}>
            {job.retry_count} / {job.max_retries}
          </span>
          <span class="text-muted font-medium">Created</span>
          <span class="text-muted">{fmtTime(job.created_at)}</span>
          <span class="text-muted font-medium">Scheduled</span>
          <span class="text-muted">{fmtTime(job.scheduled_at)}</span>
          <span class="text-muted font-medium">Started</span>
          <span class="text-muted">{job.started_at ? fmtTime(job.started_at) : "\u2014"}</span>
          <span class="text-muted font-medium">Completed</span>
          <span class="text-muted">{job.completed_at ? fmtTime(job.completed_at) : "\u2014"}</span>
          <span class="text-muted font-medium">Timeout</span>
          <span>{(job.timeout_ms / 1000).toFixed(0)}s</span>
          {job.error && (
            <>
              <span class="text-muted font-medium">Error</span>
              <span class="text-danger text-xs font-mono bg-danger-dim rounded px-2 py-1">
                {job.error}
              </span>
            </>
          )}
          {job.unique_key && (
            <>
              <span class="text-muted font-medium">Unique Key</span>
              <span class="font-mono text-xs">{job.unique_key}</span>
            </>
          )}
          {job.metadata && (
            <>
              <span class="text-muted font-medium">Metadata</span>
              <span class="font-mono text-xs">{job.metadata}</span>
            </>
          )}
        </div>
        <div class="flex gap-2.5 mt-5 pt-5 border-t dark:border-white/[0.06] border-slate-100">
          {job.status === "pending" && (
            <Button variant="danger" onClick={handleCancel}>
              Cancel Job
            </Button>
          )}
          <Button onClick={handleReplay}>
            <RotateCcw class="w-3.5 h-3.5" />
            Replay
          </Button>
        </div>
      </div>

      {errors && errors.length > 0 && (
        <div class="mt-6">
          <h3 class="text-sm font-semibold dark:text-gray-200 text-slate-700 mb-3">
            Error History <span class="text-muted font-normal">({errors.length})</span>
          </h3>
          <DataTable columns={ERROR_COLUMNS} data={errors} />
        </div>
      )}

      {logs && logs.length > 0 && (
        <div class="mt-6">
          <h3 class="text-sm font-semibold dark:text-gray-200 text-slate-700 mb-3">
            Task Logs <span class="text-muted font-normal">({logs.length})</span>
          </h3>
          <DataTable columns={LOG_COLUMNS} data={logs} />
        </div>
      )}

      {replayHistory && replayHistory.length > 0 && (
        <div class="mt-6">
          <h3 class="text-sm font-semibold dark:text-gray-200 text-slate-700 mb-3">
            Replay History <span class="text-muted font-normal">({replayHistory.length})</span>
          </h3>
          <DataTable columns={REPLAY_COLUMNS} data={replayHistory} />
        </div>
      )}

      {dag && <DagViewer dag={dag} />}

      <div class="mt-6">
        <a href="/jobs" class="text-accent-light text-[13px] hover:underline">
          {"\u2190"} Back to jobs
        </a>
      </div>
    </div>
  );
}
