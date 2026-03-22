import { useRef } from "preact/hooks";
import { LayoutDashboard } from "lucide-preact";
import { useApi } from "../hooks/use-api";
import { StatsGrid } from "../components/ui/stats-grid";
import { DataTable, type Column } from "../components/ui/data-table";
import { Badge } from "../components/ui/badge";
import { ProgressBar } from "../components/ui/progress-bar";
import { Loading } from "../components/ui/loading";
import { ThroughputChart } from "../charts/throughput-chart";
import { fmtTime, truncateId } from "../lib/format";
import { route } from "preact-router";
import type { QueueStats, Job } from "../api/types";
import type { RoutableProps } from "../lib/routes";
import { refreshInterval } from "../hooks/use-auto-refresh";

const JOB_COLUMNS: Column<Job>[] = [
  {
    header: "ID",
    accessor: (j) => <span class="font-mono text-xs text-accent-light">{truncateId(j.id)}</span>,
  },
  { header: "Task", accessor: "task_name" },
  { header: "Queue", accessor: "queue" },
  { header: "Status", accessor: (j) => <Badge status={j.status} /> },
  { header: "Progress", accessor: (j) => <ProgressBar progress={j.progress} /> },
  { header: "Created", accessor: (j) => <span class="text-muted">{fmtTime(j.created_at)}</span> },
];

export function Overview(_props: RoutableProps) {
  const { data: stats, loading: statsLoading } = useApi<QueueStats>("/api/stats");
  const { data: jobs } = useApi<Job[]>("/api/jobs?limit=10");

  const prevCompleted = useRef(0);
  const history = useRef<number[]>([]);

  if (stats) {
    const completed = stats.completed || 0;
    const ms = refreshInterval.value || 5000;
    let throughput = 0;
    if (prevCompleted.current > 0) {
      throughput = parseFloat(((completed - prevCompleted.current) / (ms / 1000)).toFixed(1));
    }
    prevCompleted.current = completed;
    history.current = [...history.current.slice(-59), throughput];
  }

  if (statsLoading && !stats) return <Loading />;

  return (
    <div>
      <div class="flex items-center gap-3 mb-6">
        <div class="p-2 rounded-lg dark:bg-surface-3 bg-slate-100">
          <LayoutDashboard class="w-5 h-5 text-accent" strokeWidth={1.8} />
        </div>
        <div>
          <h1 class="text-lg font-semibold dark:text-white text-slate-900">Overview</h1>
          <p class="text-xs text-muted">Real-time queue status</p>
        </div>
      </div>

      {stats && <StatsGrid stats={stats} />}
      <ThroughputChart data={history.current} />

      <div class="flex items-center gap-2 mb-4 mt-8">
        <h2 class="text-sm font-semibold dark:text-gray-200 text-slate-700">Recent Jobs</h2>
        <span class="text-xs text-muted">(latest 10)</span>
      </div>
      {jobs?.length ? (
        <DataTable
          columns={JOB_COLUMNS}
          data={jobs}
          onRowClick={(j) => route(`/jobs/${j.id}`)}
        />
      ) : null}
    </div>
  );
}
