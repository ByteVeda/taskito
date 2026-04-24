import { useQuery } from "@tanstack/react-query";
import { useRefreshInterval } from "@/providers";
import { fetchCircuitBreakers } from "./api";

export function useCircuitBreakers() {
  const { intervalMs } = useRefreshInterval();
  return useQuery({
    queryKey: ["circuit-breakers"],
    queryFn: ({ signal }) => fetchCircuitBreakers(signal),
    refetchInterval: intervalMs,
  });
}
