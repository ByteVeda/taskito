import { queryOptions, useQuery } from "@tanstack/react-query";
import { useRefreshInterval } from "@/providers";
import { fetchResources } from "./api";

export function resourcesQuery() {
  return queryOptions({
    queryKey: ["resources"],
    queryFn: ({ signal }) => fetchResources(signal),
    staleTime: 30_000,
  });
}

export function useResources() {
  const { intervalMs } = useRefreshInterval();
  return useQuery({ ...resourcesQuery(), refetchInterval: intervalMs });
}
