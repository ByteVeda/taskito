import { queryOptions, useQuery } from "@tanstack/react-query";
import { useRefreshInterval } from "@/providers";
import { fetchRecentJobs, fetchStats, fetchThroughput } from "./api";

// Re-export queue queries so the Overview route can import everything it needs
// from one module without reaching into a sibling feature directly.
export {
  pausedQueuesQuery,
  queueStatsQuery,
  usePausedQueues,
  useQueueStats,
} from "../queues/hooks";

export function statsQuery() {
  return queryOptions({
    queryKey: ["stats"],
    queryFn: ({ signal }) => fetchStats(signal),
  });
}

export function recentJobsQuery(limit = 10) {
  return queryOptions({
    queryKey: ["jobs", "recent", limit],
    queryFn: ({ signal }) => fetchRecentJobs(limit, signal),
  });
}

export function throughputQuery(bucketSeconds = 60, sinceSeconds = 3600) {
  return queryOptions({
    queryKey: ["metrics", "throughput", bucketSeconds, sinceSeconds],
    queryFn: ({ signal }) => fetchThroughput(bucketSeconds, sinceSeconds, signal),
  });
}

export function useStats() {
  const { intervalMs } = useRefreshInterval();
  return useQuery({ ...statsQuery(), refetchInterval: intervalMs });
}

export function useRecentJobs(limit = 10) {
  const { intervalMs } = useRefreshInterval();
  return useQuery({ ...recentJobsQuery(limit), refetchInterval: intervalMs });
}

export function useThroughput(bucketSeconds = 60, sinceSeconds = 3600) {
  const { intervalMs } = useRefreshInterval();
  return useQuery({
    ...throughputQuery(bucketSeconds, sinceSeconds),
    refetchInterval: intervalMs,
  });
}
