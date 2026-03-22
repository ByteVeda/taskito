import { Layers, Pause, Play } from "lucide-preact";
import { apiPost, type QueueStatsMap } from "../api";
import {
  Badge,
  Button,
  type Column,
  DataTable,
  EmptyState,
  ErrorState,
  Loading,
} from "../components/ui";
import { addToast, useApi } from "../hooks";
import type { RoutableProps } from "../lib";

interface QueueRow {
  name: string;
  pending: number;
  running: number;
  paused: boolean;
}

export function Queues(_props: RoutableProps) {
  const { data: queueStats, loading, error, refetch } = useApi<QueueStatsMap>("/api/stats/queues");
  const { data: pausedQueues, refetch: refetchPaused } = useApi<string[]>("/api/queues/paused");

  const pausedSet = new Set(pausedQueues ?? []);

  const rows: QueueRow[] = queueStats
    ? Object.entries(queueStats).map(([name, s]) => ({
        name,
        pending: s.pending ?? 0,
        running: s.running ?? 0,
        paused: pausedSet.has(name),
      }))
    : [];

  const handlePause = async (name: string) => {
    try {
      await apiPost(`/api/queues/${encodeURIComponent(name)}/pause`);
      addToast(`Queue "${name}" paused`, "success");
      refetch();
      refetchPaused();
    } catch {
      addToast(`Failed to pause queue "${name}"`, "error");
    }
  };

  const handleResume = async (name: string) => {
    try {
      await apiPost(`/api/queues/${encodeURIComponent(name)}/resume`);
      addToast(`Queue "${name}" resumed`, "success");
      refetch();
      refetchPaused();
    } catch {
      addToast(`Failed to resume queue "${name}"`, "error");
    }
  };

  const columns: Column<QueueRow>[] = [
    { header: "Queue", accessor: (r) => <span class="font-medium">{r.name}</span> },
    {
      header: "Pending",
      accessor: (r) => <span class="text-warning tabular-nums font-medium">{r.pending}</span>,
    },
    {
      header: "Running",
      accessor: (r) => <span class="text-info tabular-nums font-medium">{r.running}</span>,
    },
    { header: "Status", accessor: (r) => <Badge status={r.paused ? "paused" : "active"} /> },
    {
      header: "Actions",
      accessor: (r) =>
        r.paused ? (
          <Button onClick={() => handleResume(r.name)}>
            <Play class="w-3.5 h-3.5" />
            Resume
          </Button>
        ) : (
          <Button variant="ghost" onClick={() => handlePause(r.name)}>
            <Pause class="w-3.5 h-3.5" />
            Pause
          </Button>
        ),
    },
  ];

  if (error && !queueStats) return <ErrorState message={error} onRetry={refetch} />;
  if (loading && !queueStats) return <Loading />;

  return (
    <div>
      <div class="flex items-center gap-3 mb-6">
        <div class="p-2 rounded-lg dark:bg-surface-3 bg-slate-100">
          <Layers class="w-5 h-5 text-accent" strokeWidth={1.8} />
        </div>
        <div>
          <h1 class="text-lg font-semibold dark:text-white text-slate-900">Queue Management</h1>
          <p class="text-xs text-muted">Monitor and control individual queues</p>
        </div>
      </div>

      {!rows.length ? (
        <EmptyState message="No queues found" subtitle="Queues appear when tasks are enqueued" />
      ) : (
        <DataTable columns={columns} data={rows} />
      )}
    </div>
  );
}
