import { Server, Clock, Tag } from "lucide-preact";
import { useApi } from "../hooks/use-api";
import { Loading } from "../components/ui/loading";
import { EmptyState } from "../components/ui/empty-state";
import { fmtTime } from "../lib/format";
import type { QueueStats, Worker as WorkerType } from "../api/types";
import type { RoutableProps } from "../lib/routes";

export function Workers(_props: RoutableProps) {
  const { data: workers, loading } = useApi<WorkerType[]>("/api/workers");
  const { data: stats } = useApi<QueueStats>("/api/stats");

  if (loading && !workers) return <Loading />;

  return (
    <div>
      <div class="flex items-center gap-3 mb-6">
        <div class="p-2 rounded-lg dark:bg-surface-3 bg-slate-100">
          <Server class="w-5 h-5 text-accent" strokeWidth={1.8} />
        </div>
        <div>
          <h1 class="text-lg font-semibold dark:text-white text-slate-900">Workers</h1>
          <p class="text-xs text-muted">
            {workers?.length ?? 0} active {"\u00b7"} {stats?.running ?? 0} running jobs
          </p>
        </div>
      </div>

      {!workers?.length ? (
        <EmptyState message="No active workers" subtitle="Workers will appear when they connect" />
      ) : (
        <div class="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-4">
          {workers.map((w) => (
            <div
              key={w.worker_id}
              class="dark:bg-surface-2 bg-white rounded-xl shadow-sm dark:shadow-black/20 p-5 border dark:border-white/[0.06] border-slate-200 transition-all duration-150 hover:shadow-md hover:dark:shadow-black/30"
            >
              <div class="flex items-center gap-2 mb-3">
                <span class="w-2 h-2 rounded-full bg-success shadow-sm shadow-success/40" />
                <span class="font-mono text-xs text-accent-light font-medium">
                  {w.worker_id}
                </span>
              </div>
              <div class="space-y-2 text-[13px]">
                <div class="flex items-center gap-2 text-muted">
                  <Server class="w-3.5 h-3.5" />
                  Queues: <span class="dark:text-gray-200 text-slate-700">{w.queues}</span>
                </div>
                <div class="flex items-center gap-2 text-muted">
                  <Clock class="w-3.5 h-3.5" />
                  Last heartbeat: <span class="dark:text-gray-200 text-slate-700">{fmtTime(w.last_heartbeat)}</span>
                </div>
                <div class="flex items-center gap-2 text-muted">
                  <Clock class="w-3.5 h-3.5" />
                  Registered: <span class="dark:text-gray-200 text-slate-700">{fmtTime(w.registered_at)}</span>
                </div>
                {w.tags && (
                  <div class="flex items-center gap-2 text-muted">
                    <Tag class="w-3.5 h-3.5" />
                    Tags: <span class="dark:text-gray-200 text-slate-700">{w.tags}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
