import { queryOptions, useQuery } from "@tanstack/react-query";
import { useRefreshInterval } from "@/providers";
import { fetchMetrics, fetchTimeseries } from "./api";
import { type TimeRange, timeRangeConfig } from "./types";

const KEY = {
  summary: (task: string | undefined, range: TimeRange) =>
    ["metrics", "summary", task ?? "", range] as const,
  timeseries: (task: string | undefined, range: TimeRange) =>
    ["metrics", "timeseries", task ?? "", range] as const,
};

export function metricsSummaryQuery(range: TimeRange, task?: string) {
  const { sinceSeconds } = timeRangeConfig(range);
  return queryOptions({
    queryKey: KEY.summary(task, range),
    queryFn: ({ signal }) => fetchMetrics({ task, sinceSeconds }, signal),
  });
}

export function metricsTimeseriesQuery(range: TimeRange, task?: string) {
  const { sinceSeconds, bucketSeconds } = timeRangeConfig(range);
  return queryOptions({
    queryKey: KEY.timeseries(task, range),
    queryFn: ({ signal }) => fetchTimeseries({ task, sinceSeconds, bucketSeconds }, signal),
  });
}

export function useMetricsSummary(range: TimeRange, task?: string) {
  const { intervalMs } = useRefreshInterval();
  return useQuery({ ...metricsSummaryQuery(range, task), refetchInterval: intervalMs });
}

export function useMetricsTimeseries(range: TimeRange, task?: string) {
  const { intervalMs } = useRefreshInterval();
  return useQuery({ ...metricsTimeseriesQuery(range, task), refetchInterval: intervalMs });
}
