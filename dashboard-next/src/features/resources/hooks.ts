import { useQuery } from "@tanstack/react-query";
import { useRefreshInterval } from "@/providers/refresh-interval-provider";
import { fetchResources } from "./api";

export function useResources() {
  const { intervalMs } = useRefreshInterval();
  return useQuery({
    queryKey: ["resources"],
    queryFn: ({ signal }) => fetchResources(signal),
    refetchInterval: intervalMs,
  });
}
