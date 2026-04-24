import { api } from "@/lib/api-client";
import type { MetricsResponse, TimeseriesBucket } from "@/lib/api-types";

interface MetricsParams {
  task?: string;
  sinceSeconds: number;
}

export function fetchMetrics(
  params: MetricsParams,
  signal?: AbortSignal,
): Promise<MetricsResponse> {
  return api.get<MetricsResponse>("/api/metrics", {
    signal,
    params: { since: params.sinceSeconds, ...(params.task ? { task: params.task } : {}) },
  });
}

interface TimeseriesParams {
  task?: string;
  sinceSeconds: number;
  bucketSeconds: number;
}

export function fetchTimeseries(
  params: TimeseriesParams,
  signal?: AbortSignal,
): Promise<TimeseriesBucket[]> {
  return api.get<TimeseriesBucket[]>("/api/metrics/timeseries", {
    signal,
    params: {
      since: params.sinceSeconds,
      bucket: params.bucketSeconds,
      ...(params.task ? { task: params.task } : {}),
    },
  });
}
