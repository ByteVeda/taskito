import { useQuery } from "@tanstack/react-query";
import { useRefreshInterval } from "@/providers/refresh-interval-provider";
import { fetchInterceptionStats, fetchProxyStats } from "./api";

export function useProxyStats() {
  const { intervalMs } = useRefreshInterval();
  return useQuery({
    queryKey: ["system", "proxy-stats"],
    queryFn: ({ signal }) => fetchProxyStats(signal),
    refetchInterval: intervalMs,
  });
}

export function useInterceptionStats() {
  const { intervalMs } = useRefreshInterval();
  return useQuery({
    queryKey: ["system", "interception-stats"],
    queryFn: ({ signal }) => fetchInterceptionStats(signal),
    refetchInterval: intervalMs,
  });
}
