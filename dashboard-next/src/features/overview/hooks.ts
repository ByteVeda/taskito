import { useQuery } from "@tanstack/react-query";
import { useRefreshInterval } from "@/providers";
import { fetchRecentJobs, fetchStats, fetchThroughput } from "./api";

// Re-export queue hooks so the Overview route can import everything it needs
// from one module without reaching into a sibling feature directly.
export { usePausedQueues, useQueueStats } from "../queues/hooks";

export function useStats() {
  const { intervalMs } = useRefreshInterval();
  return useQuery({
    queryKey: ["stats"],
    queryFn: ({ signal }) => fetchStats(signal),
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
