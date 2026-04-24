import { useQuery } from "@tanstack/react-query";
import { useRefreshInterval } from "@/providers/refresh-interval-provider";
import { fetchWorkers } from "./api";

export function useWorkers() {
  const { intervalMs } = useRefreshInterval();
  return useQuery({
    queryKey: ["workers"],
    queryFn: ({ signal }) => fetchWorkers(signal),
    refetchInterval: intervalMs,
  });
}
