import { queryOptions, useQuery } from "@tanstack/react-query";
import { useRefreshInterval } from "@/providers";
import { fetchCircuitBreakers } from "./api";

export function circuitBreakersQuery() {
  return queryOptions({
    queryKey: ["circuit-breakers"],
    queryFn: ({ signal }) => fetchCircuitBreakers(signal),
    staleTime: 60_000,
  });
}

export function useCircuitBreakers() {
  const { intervalMs } = useRefreshInterval();
  return useQuery({ ...circuitBreakersQuery(), refetchInterval: intervalMs });
}
