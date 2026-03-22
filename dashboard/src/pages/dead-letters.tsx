import { useState } from "preact/hooks";
import { Skull, RotateCcw, Trash2 } from "lucide-preact";
import { useApi } from "../hooks/use-api";
import { DataTable, type Column } from "../components/ui/data-table";
import { Pagination } from "../components/ui/pagination";
import { Button } from "../components/ui/button";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import { Loading } from "../components/ui/loading";
import { EmptyState } from "../components/ui/empty-state";
import { addToast } from "../hooks/use-toast";
import { apiPost } from "../api/client";
import { fmtTime, truncateId } from "../lib/format";
import type { DeadLetter } from "../api/types";
import type { RoutableProps } from "../lib/routes";

const PAGE_SIZE = 20;

export function DeadLetters(_props: RoutableProps) {
  const [page, setPage] = useState(0);
  const [showPurge, setShowPurge] = useState(false);

  const { data: items, loading, refetch } = useApi<DeadLetter[]>(
    `/api/dead-letters?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`,
    [page],
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

  const columns: Column<DeadLetter>[] = [
    {
      header: "ID",
      accessor: (d) => <span class="font-mono text-xs text-accent-light">{truncateId(d.id)}</span>,
    },
    {
      header: "Original Job",
      accessor: (d) => (
        <a href={`/jobs/${d.original_job_id}`} class="font-mono text-xs text-accent-light hover:underline">
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
          {d.error ? (d.error.length > 50 ? d.error.slice(0, 50) + "\u2026" : d.error) : "\u2014"}
        </span>
      ),
      className: "max-w-[250px]",
    },
    { header: "Retries", accessor: (d) => <span class="text-warning tabular-nums">{d.retry_count}</span> },
    { header: "Failed At", accessor: (d) => <span class="text-muted">{fmtTime(d.failed_at)}</span> },
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

  if (loading && !items) return <Loading />;

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
        {items && items.length > 0 && (
          <Button variant="danger" onClick={() => setShowPurge(true)}>
            <Trash2 class="w-3.5 h-3.5" />
            Purge All
          </Button>
        )}
      </div>

      {!items?.length ? (
        <EmptyState message="No dead letters" subtitle="All jobs are processing normally" />
      ) : (
        <DataTable columns={columns} data={items}>
          <Pagination page={page} pageSize={PAGE_SIZE} itemCount={items.length} onPageChange={setPage} />
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
