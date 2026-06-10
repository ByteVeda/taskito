import { getRouteApi } from "@tanstack/react-router";
import { CheckCircle2, Clock, Zap } from "lucide-react";
import { useMemo } from "react";
import { PageHeader } from "@/components/layout";
import { StatCard } from "@/components/ui";
import type { MetricsResponse } from "@/lib/api-types";
import { formatCount, formatPercent } from "@/lib/number";
import { formatDuration } from "@/lib/time";
import {
  LatencyChart,
  MetricsTable,
  TaskSelector,
  ThroughputChart,
  TimeRangeSelector,
} from "./components";
import { useMetricsSummary, useMetricsTimeseries } from "./hooks";
import type { TimeRange } from "./types";

interface MetricsSummaryTotals {
  totalRuns: number;
  taskCount: number;
  successRate: number | null;
  slowestP95: number;
  slowestTask: string | null;
}

/** Roll the per-task summary up into the page-level stat tiles. */
function summarize(metrics: MetricsResponse | undefined): MetricsSummaryTotals {
  const entries = Object.entries(metrics ?? {});
  let totalRuns = 0;
  let totalSuccess = 0;
  let slowestP95 = 0;
  let slowestTask: string | null = null;
  for (const [task, m] of entries) {
    totalRuns += m.count;
    totalSuccess += m.success_count;
    if (m.p95_ms > slowestP95) {
      slowestP95 = m.p95_ms;
      slowestTask = task;
    }
  }
  return {
    totalRuns,
    taskCount: entries.length,
    successRate: totalRuns > 0 ? totalSuccess / totalRuns : null,
    slowestP95,
    slowestTask,
  };
}

const routeApi = getRouteApi("/metrics");

/**
 * The metrics dashboard.
 *
 * Exported as a default component so the route can dynamically import it
 * and keep Recharts off the main bundle. `range` + `task` are URL-backed so
 * views (e.g. "send_email, last 24h") are shareable.
 */
export default function MetricsPage() {
  const { range, task } = routeApi.useSearch();
  const navigate = routeApi.useNavigate();

  const setRange = (next: TimeRange) => {
    navigate({ search: (prev) => ({ ...prev, range: next }), replace: true });
  };

  const setTask = (next: string | undefined) => {
    navigate({ search: (prev) => ({ ...prev, task: next }), replace: true });
  };

  const summary = useMetricsSummary(range, task);
  const series = useMetricsTimeseries(range, task);

  const taskOptions = useMemo(() => {
    // When a task filter is set the summary will only contain that one key,
    // so we keep a stale list in state to avoid the selector collapsing.
    return summary.data ? Object.keys(summary.data).sort() : [];
  }, [summary.data]);

  const totals = useMemo(() => summarize(summary.data), [summary.data]);

  return (
    <div className="flex flex-col gap-[var(--page-gap)]">
      <PageHeader
        title="Metrics"
        description="Throughput, latency, and success rate across your tasks."
        actions={
          <>
            <TaskSelector
              value={task}
              tasks={taskOptions}
              onChange={setTask}
              className="w-[220px]"
            />
            <TimeRangeSelector value={range} onChange={setRange} />
          </>
        }
      />
      <div className="grid gap-[var(--gap)] grid-cols-[repeat(auto-fit,minmax(186px,1fr))]">
        <StatCard
          label="Total runs"
          tone="neutral"
          icon={<Zap />}
          value={formatCount(totals.totalRuns)}
          hint={`across ${formatCount(totals.taskCount)} tasks`}
        />
        <StatCard
          label="Success rate"
          tone="success"
          icon={<CheckCircle2 />}
          value={totals.successRate == null ? "—" : formatPercent(totals.successRate, 2)}
        />
        <StatCard
          label="Slowest p95"
          tone="warning"
          icon={<Clock />}
          value={totals.slowestTask ? formatDuration(totals.slowestP95) : "—"}
          hint={totals.slowestTask ?? undefined}
        />
      </div>
      <div className="grid gap-[var(--gap)] lg:grid-cols-2">
        <ThroughputChart buckets={series.data} loading={series.isLoading} />
        <LatencyChart buckets={series.data} loading={series.isLoading} />
      </div>
      <MetricsTable
        metrics={summary.data}
        loading={summary.isLoading}
        error={summary.error}
        onRetry={() => summary.refetch()}
      />
    </div>
  );
}
