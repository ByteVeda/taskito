import { useQuery } from "@tanstack/react-query";
import { useRefreshInterval } from "@/providers";
import { fetchMetrics, fetchTimeseries } from "./api";
import { type TimeRange, timeRangeConfig } from "./types";

const KEY = {
  summary: (task: string | undefined, range: TimeRange) =>
    ["metrics", "summary", task ?? "", range] as const,
  timeseries: (task: string | undefined, range: TimeRange) =>
    ["metrics", "timeseries", task ?? "", range] as const,
};

export function useMetricsSummary(range: TimeRange, task?: string) {
  const { intervalMs } = useRefreshInterval();
  const { sinceSeconds } = timeRangeConfig(range);
  return useQuery({
    queryKey: KEY.summary(task, range),
    queryFn: ({ signal }) => fetchMetrics({ task, sinceSeconds }, signal),
    refetchInterval: intervalMs,
  });
}

export function useMetricsTimeseries(range: TimeRange, task?: string) {
  const { intervalMs } = useRefreshInterval();
  const { sinceSeconds, bucketSeconds } = timeRangeConfig(range);
  return useQuery({
    queryKey: KEY.timeseries(task, range),
    queryFn: ({ signal }) => fetchTimeseries({ task, sinceSeconds, bucketSeconds }, signal),
    refetchInterval: intervalMs,
  });
}
