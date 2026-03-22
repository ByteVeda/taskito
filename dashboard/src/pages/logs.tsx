import { ScrollText } from "lucide-preact";
import { useState } from "preact/hooks";
import type { TaskLog } from "../api";
import { Badge, type Column, DataTable, EmptyState, ErrorState, Loading } from "../components/ui";
import { useApi } from "../hooks";
import { fmtTime, type RoutableProps, truncateId } from "../lib";

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
  { header: "Task", accessor: (l) => <span class="font-medium">{l.task_name}</span> },
  {
    header: "Job",
    accessor: (l) => (
      <a href={`/jobs/${l.job_id}`} class="font-mono text-xs text-accent-light hover:underline">
        {truncateId(l.job_id)}
      </a>
    ),
  },
  { header: "Message", accessor: "message" },
  { header: "Extra", accessor: (l) => l.extra ?? "\u2014", className: "max-w-[200px] truncate" },
];

export function Logs(_props: RoutableProps) {
  const [taskFilter, setTaskFilter] = useState("");
  const [levelFilter, setLevelFilter] = useState("");

  const params = new URLSearchParams({ limit: "100" });
  if (taskFilter) params.set("task", taskFilter);
  if (levelFilter) params.set("level", levelFilter);

  const {
    data: logs,
    loading,
    error,
    refetch,
  } = useApi<TaskLog[]>(`/api/logs?${params}`, [taskFilter, levelFilter]);

  const inputClass =
    "dark:bg-surface-3 bg-white dark:text-gray-200 text-slate-700 border dark:border-white/[0.06] border-slate-200 rounded-lg px-3 py-2 text-[13px] placeholder:text-muted/50 focus:border-accent/50 transition-colors";

  return (
    <div>
      <div class="flex items-center gap-3 mb-6">
        <div class="p-2 rounded-lg dark:bg-surface-3 bg-slate-100">
          <ScrollText class="w-5 h-5 text-accent" strokeWidth={1.8} />
        </div>
        <div>
          <h1 class="text-lg font-semibold dark:text-white text-slate-900">Logs</h1>
          <p class="text-xs text-muted">Structured task execution logs</p>
        </div>
      </div>

      <div class="flex gap-2.5 mb-5">
        <input
          class={`${inputClass} w-44`}
          placeholder="Filter by task\u2026"
          value={taskFilter}
          onInput={(e) => setTaskFilter((e.target as HTMLInputElement).value)}
        />
        <select
          class={inputClass}
          value={levelFilter}
          onChange={(e) => setLevelFilter((e.target as HTMLSelectElement).value)}
        >
          <option value="">All levels</option>
          <option value="error">Error</option>
          <option value="warning">Warning</option>
          <option value="info">Info</option>
          <option value="debug">Debug</option>
        </select>
      </div>

      {error && !logs ? (
        <ErrorState message={error} onRetry={refetch} />
      ) : loading && !logs ? (
        <Loading />
      ) : !logs?.length ? (
        <EmptyState message="No logs yet" subtitle="Logs appear when tasks execute" />
      ) : (
        <DataTable columns={LOG_COLUMNS} data={logs} />
      )}
    </div>
  );
}
