import { getRouteApi } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout";
import type { LogLevel } from "./api";
import { LogFilters, LogStream } from "./components";
import { useLogs } from "./hooks";
import { LOGS_DEFAULT_SINCE_SECONDS, LOGS_PAGE_SIZE } from "./search-schema";

const routeApi = getRouteApi("/logs");

/**
 * Logs route body. Default-exported so the route file can lazy-load the
 * entire logs surface (including the virtual list dependency) on demand.
 */
export default function LogsPage() {
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();

  const setFilter = (next: { task?: string; level?: LogLevel }) => {
    navigate({
      search: () => ({
        task: next.task,
        level: next.level,
      }),
      replace: true,
    });
  };

  const logs = useLogs({
    task: search.task,
    level: search.level,
    sinceSeconds: LOGS_DEFAULT_SINCE_SECONDS,
    limit: LOGS_PAGE_SIZE,
  });

  return (
    <>
      <PageHeader title="Logs" description="Live-tailing task log stream across all workers." />
      <div className="flex flex-col gap-3">
        <LogFilters task={search.task} level={search.level} onChange={setFilter} />
        <LogStream
          logs={logs.data}
          loading={logs.isLoading || (logs.isFetching && !logs.data)}
          error={logs.error}
          onRetry={() => logs.refetch()}
        />
      </div>
    </>
  );
}
