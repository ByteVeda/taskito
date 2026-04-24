import { useState } from "react";
import { PageHeader } from "@/components/layout";
import type { LogLevel } from "./api";
import { LogFilters, LogStream } from "./components";
import { useLogs } from "./hooks";

const DEFAULT_SINCE_SECONDS = 3_600;
const PAGE_SIZE = 500;

/**
 * Logs route body. Default-exported so the route file can lazy-load the
 * entire logs surface (including the virtual list dependency) on demand.
 */
export default function LogsPage() {
  const [task, setTask] = useState<string | undefined>(undefined);
  const [level, setLevel] = useState<LogLevel | undefined>(undefined);

  const logs = useLogs({
    task,
    level,
    sinceSeconds: DEFAULT_SINCE_SECONDS,
    limit: PAGE_SIZE,
  });

  return (
    <>
      <PageHeader title="Logs" description="Live-tailing task log stream across all workers." />
      <div className="flex flex-col gap-3">
        <LogFilters
          task={task}
          level={level}
          onChange={(next) => {
            setTask(next.task);
            setLevel(next.level);
          }}
        />
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
