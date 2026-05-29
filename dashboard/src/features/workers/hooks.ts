import { queryOptions, useQuery } from "@tanstack/react-query";
import { useRefreshInterval } from "@/providers";
import { fetchWorkers } from "./api";

export function workersQuery() {
  return queryOptions({
    queryKey: ["workers"],
    queryFn: ({ signal }) => fetchWorkers(signal),
    // Slow-moving: poll on the user interval, but don't refetch on remount
    // within the window.
    staleTime: 30_000,
  });
}

export function useWorkers() {
  const { intervalMs } = useRefreshInterval();
  return useQuery({ ...workersQuery(), refetchInterval: intervalMs });
}
