import { api } from "@/lib/api-client";
import type { Job, QueueStats, QueueStatsMap, TimeseriesBucket } from "@/lib/api-types";

export function fetchStats(signal?: AbortSignal): Promise<QueueStats> {
  return api.get<QueueStats>("/api/stats", { signal });
}

export function fetchQueueStats(signal?: AbortSignal): Promise<QueueStatsMap> {
  return api.get<QueueStatsMap>("/api/stats/queues", { signal });
}

export function fetchPausedQueues(signal?: AbortSignal): Promise<string[]> {
  return api.get<string[]>("/api/queues/paused", { signal });
}

export function fetchRecentJobs(limit: number, signal?: AbortSignal): Promise<Job[]> {
  return api.get<Job[]>("/api/jobs", { signal, params: { limit } });
}

export function fetchThroughput(
  bucketSeconds: number,
  sinceSeconds: number,
  signal?: AbortSignal,
): Promise<TimeseriesBucket[]> {
  return api.get<TimeseriesBucket[]>("/api/metrics/timeseries", {
    signal,
    params: { bucket: bucketSeconds, since: sinceSeconds },
  });
}
