import { useQuery } from "@tanstack/react-query";
import { useRefreshInterval } from "@/providers/refresh-interval-provider";
import {
  fetchPausedQueues,
  fetchQueueStats,
  fetchRecentJobs,
  fetchStats,
  fetchThroughput,
} from "./api";

export function useStats() {
  const { intervalMs } = useRefreshInterval();
  return useQuery({
    queryKey: ["stats"],
    queryFn: ({ signal }) => fetchStats(signal),
    refetchInterval: intervalMs,
  });
}

export function useQueueStats() {
  const { intervalMs } = useRefreshInterval();
  return useQuery({
    queryKey: ["stats", "queues"],
    queryFn: ({ signal }) => fetchQueueStats(signal),
    refetchInterval: intervalMs,
  });
}

export function usePausedQueues() {
  const { intervalMs } = useRefreshInterval();
  return useQuery({
    queryKey: ["queues", "paused"],
    queryFn: ({ signal }) => fetchPausedQueues(signal),
    refetchInterval: intervalMs,
  });
}

export function useRecentJobs(limit = 10) {
  const { intervalMs } = useRefreshInterval();
  return useQuery({
    queryKey: ["jobs", "recent", limit],
    queryFn: ({ signal }) => fetchRecentJobs(limit, signal),
    refetchInterval: intervalMs,
  });
}

export function useThroughput(bucketSeconds = 60, sinceSeconds = 3600) {
  const { intervalMs } = useRefreshInterval();
  return useQuery({
    queryKey: ["metrics", "throughput", bucketSeconds, sinceSeconds],
    queryFn: ({ signal }) => fetchThroughput(bucketSeconds, sinceSeconds, signal),
    refetchInterval: intervalMs,
  });
}
