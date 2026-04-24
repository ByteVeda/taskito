import { getRouteApi } from "@tanstack/react-router";
import { useMemo } from "react";
import { PageHeader } from "@/components/layout";
import {
  LatencyChart,
  MetricsTable,
  TaskSelector,
  ThroughputChart,
  TimeRangeSelector,
} from "./components";
import { useMetricsSummary, useMetricsTimeseries } from "./hooks";
import type { TimeRange } from "./types";

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

  return (
    <>
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
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 lg:grid-cols-2">
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
    </>
  );
}
