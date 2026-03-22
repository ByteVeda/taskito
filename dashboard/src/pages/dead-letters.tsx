import { ChevronDown, ChevronRight, Group, List, RotateCcw, Skull, Trash2 } from "lucide-preact";
import { useState } from "preact/hooks";
import { apiPost, type DeadLetter } from "../api";
import {
  Button,
  type Column,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  Loading,
  Pagination,
} from "../components/ui";
import { addToast, useApi } from "../hooks";
import { fmtTime, type RoutableProps, truncateId } from "../lib";

const PAGE_SIZE = 20;

interface ErrorGroup {
  error: string;
  items: DeadLetter[];
}

function groupByError(items: DeadLetter[]): ErrorGroup[] {
  const map = new Map<string, DeadLetter[]>();
  for (const item of items) {
    const key = item.error ?? "(no error message)";
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  }
  return Array.from(map.entries())
    .map(([error, items]) => ({ error, items }))
    .sort((a, b) => b.items.length - a.items.length);
}

export function DeadLetters(_props: RoutableProps) {
  const [page, setPage] = useState(0);
  const [showPurge, setShowPurge] = useState(false);
  const [grouped, setGrouped] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const {
    data: items,
    loading,
    error,
    refetch,
  } = useApi<DeadLetter[]>(
    `/api/dead-letters?limit=${grouped ? 200 : PAGE_SIZE}&offset=${grouped ? 0 : page * PAGE_SIZE}`,
    [page, grouped],
  );

  const handleRetry = async (id: string) => {
    try {
      await apiPost<{ new_job_id: string }>(`/api/dead-letters/${id}/retry`);
      addToast("Dead letter retried", "success");
      refetch();
    } catch {
      addToast("Failed to retry dead letter", "error");
    }
  };

  const handleRetryGroup = async (group: ErrorGroup) => {
    let retried = 0;
    for (const item of group.items) {
      try {
        await apiPost<{ new_job_id: string }>(`/api/dead-letters/${item.id}/retry`);
        retried++;
      } catch {
        /* skip failed */
      }
    }
    addToast(
      `Retried ${retried} of ${group.items.length} dead letters`,
      retried > 0 ? "success" : "error",
    );
    refetch();
  };

  const handlePurge = async () => {
    setShowPurge(false);
    try {
      const res = await apiPost<{ purged: number }>("/api/dead-letters/purge");
      addToast(`Purged ${res.purged} dead letters`, "success");
      refetch();
    } catch {
      addToast("Failed to purge dead letters", "error");
    }
  };

  const toggleGroup = (error: string) => {
    const next = new Set(expandedGroups);
    if (next.has(error)) next.delete(error);
    else next.add(error);
    setExpandedGroups(next);
  };

  const columns: Column<DeadLetter>[] = [
    {
      header: "ID",
      accessor: (d) => <span class="font-mono text-xs text-accent-light">{truncateId(d.id)}</span>,
    },
    {
      header: "Original Job",
      accessor: (d) => (
        <a
          href={`/jobs/${d.original_job_id}`}
          class="font-mono text-xs text-accent-light hover:underline"
        >
          {truncateId(d.original_job_id)}
        </a>
      ),
    },
    { header: "Task", accessor: (d) => <span class="font-medium">{d.task_name}</span> },
    { header: "Queue", accessor: "queue" },
    {
      header: "Error",
      accessor: (d) => (
        <span class="text-danger text-xs" title={d.error ?? ""}>
          {d.error ? (d.error.length > 50 ? `${d.error.slice(0, 50)}\u2026` : d.error) : "\u2014"}
        </span>
      ),
      className: "max-w-[250px]",
    },
    {
      header: "Retries",
      accessor: (d) => <span class="text-warning tabular-nums">{d.retry_count}</span>,
    },
    {
      header: "Failed At",
      accessor: (d) => <span class="text-muted">{fmtTime(d.failed_at)}</span>,
    },
    {
      header: "Actions",
      accessor: (d) => (
        <Button onClick={() => handleRetry(d.id)}>
          <RotateCcw class="w-3.5 h-3.5" />
          Retry
        </Button>
      ),
    },
  ];

  if (error && !items) return <ErrorState message={error} onRetry={refetch} />;
  if (loading && !items) return <Loading />;

  const groups = grouped && items ? groupByError(items) : [];

  return (
    <div>
      <div class="flex items-center justify-between mb-6">
        <div class="flex items-center gap-3">
          <div class="p-2 rounded-lg bg-danger-dim">
            <Skull class="w-5 h-5 text-danger" strokeWidth={1.8} />
          </div>
          <div>
            <h1 class="text-lg font-semibold dark:text-white text-slate-900">Dead Letters</h1>
            <p class="text-xs text-muted">Failed jobs that exhausted all retries</p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          {items && items.length > 0 && (
            <>
              <div class="flex dark:bg-surface-3 bg-slate-100 rounded-lg p-1">
                <button
                  type="button"
                  onClick={() => {
                    setGrouped(false);
                    setPage(0);
                  }}
                  class={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border-none cursor-pointer transition-all duration-150 ${
                    !grouped
                      ? "bg-accent text-white shadow-sm shadow-accent/20"
                      : "bg-transparent dark:text-gray-400 text-slate-500 hover:dark:text-white"
                  }`}
                >
                  <List class="w-3.5 h-3.5" />
                  List
                </button>
                <button
                  type="button"
                  onClick={() => setGrouped(true)}
                  class={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border-none cursor-pointer transition-all duration-150 ${
                    grouped
                      ? "bg-accent text-white shadow-sm shadow-accent/20"
                      : "bg-transparent dark:text-gray-400 text-slate-500 hover:dark:text-white"
                  }`}
                >
                  <Group class="w-3.5 h-3.5" />
                  Group
                </button>
              </div>
              <Button variant="danger" onClick={() => setShowPurge(true)}>
                <Trash2 class="w-3.5 h-3.5" />
                Purge All
              </Button>
            </>
          )}
        </div>
      </div>

      {!items?.length ? (
        <EmptyState message="No dead letters" subtitle="All jobs are processing normally" />
      ) : grouped ? (
        /* Grouped view */
        <div class="space-y-3">
          {groups.map((group) => {
            const isExpanded = expandedGroups.has(group.error);
            return (
              <div
                key={group.error}
                class="dark:bg-surface-2 bg-white rounded-xl shadow-sm dark:shadow-black/20 border dark:border-white/[0.06] border-slate-200 overflow-hidden"
              >
                <div
                  class="flex items-center gap-3 px-5 py-4 cursor-pointer hover:dark:bg-white/[0.02] hover:bg-slate-50 transition-colors"
                  onClick={() => toggleGroup(group.error)}
                >
                  {isExpanded ? (
                    <ChevronDown class="w-4 h-4 text-muted shrink-0" />
                  ) : (
                    <ChevronRight class="w-4 h-4 text-muted shrink-0" />
                  )}
                  <div class="flex-1 min-w-0">
                    <span class="text-danger text-sm font-mono truncate block">{group.error}</span>
                  </div>
                  <span class="shrink-0 px-2.5 py-0.5 rounded-full text-xs font-semibold tabular-nums bg-danger/10 text-danger border border-danger/20">
                    {group.items.length}
                  </span>
                  <Button
                    onClick={() => {
                      handleRetryGroup(group);
                    }}
                  >
                    <RotateCcw class="w-3.5 h-3.5" />
                    Retry All
                  </Button>
                </div>
                {isExpanded && (
                  <div class="border-t dark:border-white/[0.04] border-slate-100">
                    <DataTable columns={columns} data={group.items} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* List view */
        <DataTable columns={columns} data={items}>
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            itemCount={items.length}
            onPageChange={setPage}
          />
        </DataTable>
      )}

      {showPurge && (
        <ConfirmDialog
          message="Purge all dead letters? This cannot be undone."
          onConfirm={handlePurge}
          onCancel={() => setShowPurge(false)}
        />
      )}
    </div>
  );
}
