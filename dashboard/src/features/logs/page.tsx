import { getRouteApi } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/layout";
import { Button, Card, CardContent, LiveDot } from "@/components/ui";
import { formatCount } from "@/lib/number";
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
  const [live, setLive] = useState(true);

  const setFilter = (next: { task?: string; level?: LogLevel }) => {
    navigate({
      search: () => ({
        task: next.task,
        level: next.level,
      }),
      replace: true,
    });
  };

  const logs = useLogs(
    {
      task: search.task,
      level: search.level,
      sinceSeconds: LOGS_DEFAULT_SINCE_SECONDS,
      limit: LOGS_PAGE_SIZE,
    },
    live,
  );

  const lineCount = logs.data?.length ?? 0;

  return (
    <div className="flex flex-col gap-[var(--page-gap)]">
      <PageHeader
        eyebrow="Monitoring"
        title="Logs"
        description="A live tail of structured task logs across every worker."
        actions={
          <Button
            variant={live ? "default" : "outline"}
            aria-pressed={live}
            onClick={() => setLive((v) => !v)}
          >
            {live ? <LiveDot tone="accent" /> : null}
            {live ? "Live tail on" : "Paused"}
          </Button>
        }
      />
      <div className="flex flex-wrap items-center gap-2.5">
        <LogFilters task={search.task} level={search.level} onChange={setFilter} />
        <span className="ml-auto font-mono text-xs tabular-nums text-[var(--fg-subtle)]">
          {formatCount(lineCount)} lines
        </span>
      </div>
      <Card>
        <CardContent className="p-0">
          <LogStream
            logs={logs.data}
            loading={logs.isLoading || (logs.isFetching && !logs.data)}
            error={logs.error}
            onRetry={() => logs.refetch()}
          />
        </CardContent>
      </Card>
    </div>
  );
}
