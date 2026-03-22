import { Ban, ListTodo, RotateCcw, Search, X } from "lucide-preact";
import { useState } from "preact/hooks";
import { route } from "preact-router";
import { apiPost, type Job, type QueueStats } from "../api";
import {
  Badge,
  Button,
  type Column,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  Loading,
  Pagination,
  ProgressBar,
  StatsGrid,
} from "../components/ui";
import { addToast, useApi } from "../hooks";
import { fmtTime, type RoutableProps, truncateId } from "../lib";

interface Filters {
  status: string;
  queue: string;
  task: string;
  metadata: string;
  error: string;
  created_after: string;
  created_before: string;
}

const PAGE_SIZE = 20;

const JOB_COLUMNS: Column<Job>[] = [
  {
    header: "ID",
    accessor: (j) => <span class="font-mono text-xs text-accent-light">{truncateId(j.id)}</span>,
  },
  { header: "Task", accessor: "task_name" },
  { header: "Queue", accessor: "queue" },
  { header: "Status", accessor: (j) => <Badge status={j.status} /> },
  { header: "Priority", accessor: "priority" },
  { header: "Progress", accessor: (j) => <ProgressBar progress={j.progress} /> },
  {
    header: "Retries",
    accessor: (j) => (
      <span class={j.retry_count > 0 ? "text-warning" : "text-muted"}>
        {j.retry_count}/{j.max_retries}
      </span>
    ),
  },
  {
    header: "Created",
    accessor: (j) => <span class="text-muted">{fmtTime(j.created_at)}</span>,
  },
];

function buildUrl(filters: Filters, page: number): string {
  const params = new URLSearchParams();
  params.set("limit", String(PAGE_SIZE));
  params.set("offset", String(page * PAGE_SIZE));
  if (filters.status) params.set("status", filters.status);
  if (filters.queue) params.set("queue", filters.queue);
  if (filters.task) params.set("task", filters.task);
  if (filters.metadata) params.set("metadata", filters.metadata);
  if (filters.error) params.set("error", filters.error);
  if (filters.created_after)
    params.set("created_after", String(new Date(filters.created_after).getTime()));
  if (filters.created_before)
    params.set("created_before", String(new Date(filters.created_before).getTime()));
  return `/api/jobs?${params}`;
}

export function Jobs(_props: RoutableProps) {
  const [filters, setFilters] = useState<Filters>({
    status: "",
    queue: "",
    task: "",
    metadata: "",
    error: "",
    created_after: "",
    created_before: "",
  });
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showBulkCancel, setShowBulkCancel] = useState(false);

  const {
    data: stats,
    error: statsError,
    refetch: refetchStats,
  } = useApi<QueueStats>("/api/stats");
  const {
    data: jobs,
    loading,
    error: jobsError,
    refetch,
  } = useApi<Job[]>(buildUrl(filters, page), [
    filters.status,
    filters.queue,
    filters.task,
    filters.metadata,
    filters.error,
    filters.created_after,
    filters.created_before,
    page,
  ]);

  const updateFilter = (key: keyof Filters, value: string) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(0);
    setSelected(new Set());
  };

  const handleBulkCancel = async () => {
    setShowBulkCancel(false);
    let cancelled = 0;
    for (const id of selected) {
      try {
        const res = await apiPost<{ cancelled: boolean }>(`/api/jobs/${id}/cancel`);
        if (res.cancelled) cancelled++;
      } catch {
        /* skip failed */
      }
    }
    addToast(
      `Cancelled ${cancelled} of ${selected.size} jobs`,
      cancelled > 0 ? "success" : "error",
    );
    setSelected(new Set());
    refetch();
  };

  const handleBulkReplay = async () => {
    let replayed = 0;
    for (const id of selected) {
      try {
        await apiPost<{ replay_job_id: string }>(`/api/jobs/${id}/replay`);
        replayed++;
      } catch {
        /* skip failed */
      }
    }
    addToast(`Replayed ${replayed} of ${selected.size} jobs`, replayed > 0 ? "success" : "error");
    setSelected(new Set());
    refetch();
  };

  const inputClass =
    "dark:bg-surface-3 bg-white dark:text-gray-200 text-slate-700 border dark:border-white/[0.06] border-slate-200 rounded-lg px-3 py-2 text-[13px] placeholder:text-muted/50 focus:border-accent/50 transition-colors";

  return (
    <div>
      <div class="flex items-center gap-3 mb-6">
        <div class="p-2 rounded-lg dark:bg-surface-3 bg-slate-100">
          <ListTodo class="w-5 h-5 text-accent" strokeWidth={1.8} />
        </div>
        <div>
          <h1 class="text-lg font-semibold dark:text-white text-slate-900">Jobs</h1>
          <p class="text-xs text-muted">Browse and filter task queue jobs</p>
        </div>
      </div>

      {stats && <StatsGrid stats={stats} />}

      <div class="dark:bg-surface-2 bg-white rounded-xl p-4 mb-4 border dark:border-white/[0.06] border-slate-200">
        <div class="flex items-center gap-2 mb-3 text-xs text-muted font-medium uppercase tracking-wider">
          <Search class="w-3.5 h-3.5" />
          Filters
        </div>
        <div class="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-2.5">
          <select
            class={inputClass}
            value={filters.status}
            onChange={(e) => updateFilter("status", (e.target as HTMLSelectElement).value)}
          >
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="running">Running</option>
            <option value="complete">Complete</option>
            <option value="failed">Failed</option>
            <option value="dead">Dead</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <input
            class={inputClass}
            placeholder="Queue\u2026"
            value={filters.queue}
            onInput={(e) => updateFilter("queue", (e.target as HTMLInputElement).value)}
          />
          <input
            class={inputClass}
            placeholder="Task\u2026"
            value={filters.task}
            onInput={(e) => updateFilter("task", (e.target as HTMLInputElement).value)}
          />
          <input
            class={inputClass}
            placeholder="Metadata\u2026"
            value={filters.metadata}
            onInput={(e) => updateFilter("metadata", (e.target as HTMLInputElement).value)}
          />
          <input
            class={inputClass}
            placeholder="Error text\u2026"
            value={filters.error}
            onInput={(e) => updateFilter("error", (e.target as HTMLInputElement).value)}
          />
          <input
            class={inputClass}
            type="date"
            title="Created after"
            value={filters.created_after}
            onInput={(e) => updateFilter("created_after", (e.target as HTMLInputElement).value)}
          />
          <input
            class={inputClass}
            type="date"
            title="Created before"
            value={filters.created_before}
            onInput={(e) => updateFilter("created_before", (e.target as HTMLInputElement).value)}
          />
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div class="flex items-center gap-3 mb-4 px-4 py-3 rounded-xl dark:bg-accent/[0.08] bg-accent/[0.04] border dark:border-accent/20 border-accent/10">
          <span class="text-sm font-medium dark:text-gray-200 text-slate-700">
            {selected.size} job{selected.size > 1 ? "s" : ""} selected
          </span>
          <div class="flex gap-2 ml-auto">
            <Button variant="danger" onClick={() => setShowBulkCancel(true)}>
              <Ban class="w-3.5 h-3.5" />
              Cancel Selected
            </Button>
            <Button onClick={handleBulkReplay}>
              <RotateCcw class="w-3.5 h-3.5" />
              Replay Selected
            </Button>
            <Button variant="ghost" onClick={() => setSelected(new Set())}>
              <X class="w-3.5 h-3.5" />
              Clear
            </Button>
          </div>
        </div>
      )}

      {jobsError && !jobs ? (
        <ErrorState message={jobsError} onRetry={refetch} />
      ) : loading && !jobs ? (
        <Loading />
      ) : !jobs?.length ? (
        <EmptyState message="No jobs found" subtitle="Try adjusting your filters" />
      ) : (
        <DataTable
          columns={JOB_COLUMNS}
          data={jobs}
          onRowClick={(j) => route(`/jobs/${j.id}`)}
          selectable
          selectedKeys={selected}
          rowKey={(j) => j.id}
          onSelectionChange={setSelected}
        >
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            itemCount={jobs.length}
            onPageChange={setPage}
          />
        </DataTable>
      )}

      {showBulkCancel && (
        <ConfirmDialog
          message={`Cancel ${selected.size} selected job${selected.size > 1 ? "s" : ""}? Only pending jobs can be cancelled.`}
          onConfirm={handleBulkCancel}
          onCancel={() => setShowBulkCancel(false)}
        />
      )}
    </div>
  );
}
