import { useState } from "preact/hooks";
import { BarChart3 } from "lucide-preact";
import { useApi } from "../hooks/use-api";
import { DataTable, type Column } from "../components/ui/data-table";
import { Loading } from "../components/ui/loading";
import { EmptyState } from "../components/ui/empty-state";
import { TimeseriesChart } from "../charts/timeseries-chart";
import type { MetricsResponse, TaskMetrics, TimeseriesBucket } from "../api/types";
import type { RoutableProps } from "../lib/routes";

interface MetricsRow extends TaskMetrics {
  task_name: string;
}

function latencyColor(ms: number, threshold: { good: number; warn: number }): string {
  if (ms <= threshold.good) return "text-success";
  if (ms <= threshold.warn) return "text-warning";
  return "text-danger";
}

const METRICS_COLUMNS: Column<MetricsRow>[] = [
  { header: "Task", accessor: (r) => <span class="font-medium">{r.task_name}</span> },
  { header: "Total", accessor: (r) => <span class="tabular-nums">{r.count}</span> },
  { header: "Success", accessor: (r) => <span class="text-success tabular-nums">{r.success_count}</span> },
  { header: "Failures", accessor: (r) => <span class={r.failure_count > 0 ? "text-danger tabular-nums" : "text-muted tabular-nums"}>{r.failure_count}</span> },
  { header: "Avg", accessor: (r) => <span class={`tabular-nums ${latencyColor(r.avg_ms, { good: 100, warn: 500 })}`}>{r.avg_ms}ms</span> },
  { header: "P50", accessor: (r) => <span class="tabular-nums text-muted">{r.p50_ms}ms</span> },
  { header: "P95", accessor: (r) => <span class={`tabular-nums ${latencyColor(r.p95_ms, { good: 200, warn: 1000 })}`}>{r.p95_ms}ms</span> },
  { header: "P99", accessor: (r) => <span class={`tabular-nums ${latencyColor(r.p99_ms, { good: 500, warn: 2000 })}`}>{r.p99_ms}ms</span> },
  { header: "Min", accessor: (r) => <span class="tabular-nums text-muted">{r.min_ms}ms</span> },
  { header: "Max", accessor: (r) => <span class={`tabular-nums ${latencyColor(r.max_ms, { good: 1000, warn: 5000 })}`}>{r.max_ms}ms</span> },
];

const TIME_RANGES = [
  { label: "1h", seconds: 3600 },
  { label: "6h", seconds: 21600 },
  { label: "24h", seconds: 86400 },
];

export function Metrics(_props: RoutableProps) {
  const [since, setSince] = useState(3600);
  const { data: metrics, loading } = useApi<MetricsResponse>(`/api/metrics?since=${since}`, [since]);
  const { data: timeseries } = useApi<TimeseriesBucket[]>(
    `/api/metrics/timeseries?since=${since}&bucket=${since <= 3600 ? 60 : since <= 21600 ? 300 : 900}`,
    [since],
  );

  const rows: MetricsRow[] = metrics
    ? Object.entries(metrics).map(([task_name, m]) => ({ task_name, ...m }))
    : [];

  return (
    <div>
      <div class="flex items-center justify-between mb-6">
        <div class="flex items-center gap-3">
          <div class="p-2 rounded-lg dark:bg-surface-3 bg-slate-100">
            <BarChart3 class="w-5 h-5 text-accent" strokeWidth={1.8} />
          </div>
          <div>
            <h1 class="text-lg font-semibold dark:text-white text-slate-900">Metrics</h1>
            <p class="text-xs text-muted">Task performance and throughput</p>
          </div>
        </div>
        <div class="flex gap-1 dark:bg-surface-3 bg-slate-100 rounded-lg p-1">
          {TIME_RANGES.map((r) => (
            <button
              key={r.label}
              onClick={() => setSince(r.seconds)}
              class={`px-3 py-1.5 text-xs font-medium rounded-md border-none cursor-pointer transition-all duration-150 ${
                since === r.seconds
                  ? "bg-accent text-white shadow-sm shadow-accent/20"
                  : "bg-transparent dark:text-gray-400 text-slate-500 hover:dark:text-white hover:text-slate-900"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {timeseries && timeseries.length > 0 && (
        <TimeseriesChart data={timeseries} />
      )}

      {loading && !metrics ? (
        <Loading />
      ) : !rows.length ? (
        <EmptyState message="No metrics yet" subtitle="Run some tasks to see performance data" />
      ) : (
        <DataTable columns={METRICS_COLUMNS} data={rows} />
      )}
    </div>
  );
}
