import { ScrollText } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import type { TaskLog } from "@/lib/api-types";
import { cn } from "@/lib/cn";
import { formatAbsolute } from "@/lib/time";

interface JobLogsTabProps {
  logs: TaskLog[] | undefined;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
}

const LEVEL_STYLE: Record<string, string> = {
  error: "text-danger",
  warning: "text-warning",
  warn: "text-warning",
  info: "text-info",
  debug: "text-[var(--fg-subtle)]",
};

export function JobLogsTab({ logs, loading, error, onRetry }: JobLogsTabProps) {
  if (error) {
    return <ErrorState title="Couldn't load logs" description={error.message} onRetry={onRetry} />;
  }

  if (loading && !logs) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (!logs || logs.length === 0) {
    return <EmptyState icon={ScrollText} title="No logs recorded for this job" />;
  }

  return (
    <div className="rounded-lg bg-[var(--surface)] ring-1 ring-inset ring-[var(--border)]">
      <ul className="divide-y divide-[var(--border)] font-mono text-[11px]">
        {logs.map((log, i) => {
          const levelClass = LEVEL_STYLE[log.level.toLowerCase()] ?? "text-[var(--fg-muted)]";
          const key = `${log.logged_at}-${log.level}-${i}`;
          return (
            <li key={key} className="flex gap-3 px-4 py-2 hover:bg-[var(--surface-2)]/60">
              <span className="shrink-0 text-[var(--fg-subtle)]">
                {formatAbsolute(log.logged_at * 1000)}
              </span>
              <span className={cn("shrink-0 uppercase", levelClass)}>{log.level}</span>
              <span className="flex-1 whitespace-pre-wrap break-words text-[var(--fg)]">
                {log.message}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
