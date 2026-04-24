import { useMemo, useState } from "react";
import { PageHeader } from "@/components/layout";
import {
  LatencyChart,
  MetricsTable,
  TaskSelector,
  ThroughputChart,
  TimeRangeSelector,
} from "./components";
import { useMetricsSummary, useMetricsTimeseries } from "./hooks";
import { DEFAULT_TIME_RANGE, type TimeRange } from "./types";

/**
 * The metrics dashboard.
 *
 * Exported as a default component so the route can dynamically import it
 * and keep Recharts off the main bundle. Time range + task filter live as
 * local state; if they turn out to be shareable we can promote to URL.
 */
export default function MetricsPage() {
  const [range, setRange] = useState<TimeRange>(DEFAULT_TIME_RANGE);
  const [task, setTask] = useState<string | undefined>(undefined);

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
