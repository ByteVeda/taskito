import { keepPreviousData, queryOptions, useQuery } from "@tanstack/react-query";
import { useRefreshInterval } from "@/providers";
import { fetchLogs, type LogsQuery } from "./api";

const KEY = (q: LogsQuery) => ["logs", q.task ?? "", q.level ?? "", q.sinceSeconds, q.limit];

export function logsListQuery(query: LogsQuery) {
  return queryOptions({
    queryKey: KEY(query),
    queryFn: ({ signal }) => fetchLogs(query, signal),
    placeholderData: keepPreviousData,
  });
}

export function useLogs(query: LogsQuery) {
  const { intervalMs } = useRefreshInterval();
  return useQuery({ ...logsListQuery(query), refetchInterval: intervalMs });
}
