import { queryOptions, useQuery } from "@tanstack/react-query";
import { useRefreshInterval } from "@/providers";
import { fetchWorkers } from "./api";

export function workersQuery() {
  return queryOptions({
    queryKey: ["workers"],
    queryFn: ({ signal }) => fetchWorkers(signal),
  });
}

export function useWorkers() {
  const { intervalMs } = useRefreshInterval();
  return useQuery({ ...workersQuery(), refetchInterval: intervalMs });
}
