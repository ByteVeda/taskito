import { queryOptions, useQuery } from "@tanstack/react-query";
import { useRefreshInterval } from "@/providers";
import { fetchInterceptionStats, fetchProxyStats } from "./api";

export function proxyStatsQuery() {
  return queryOptions({
    queryKey: ["system", "proxy-stats"],
    queryFn: ({ signal }) => fetchProxyStats(signal),
  });
}

export function interceptionStatsQuery() {
  return queryOptions({
    queryKey: ["system", "interception-stats"],
    queryFn: ({ signal }) => fetchInterceptionStats(signal),
  });
}

export function useProxyStats() {
  const { intervalMs } = useRefreshInterval();
  return useQuery({ ...proxyStatsQuery(), refetchInterval: intervalMs });
}

export function useInterceptionStats() {
  const { intervalMs } = useRefreshInterval();
  return useQuery({ ...interceptionStatsQuery(), refetchInterval: intervalMs });
}
