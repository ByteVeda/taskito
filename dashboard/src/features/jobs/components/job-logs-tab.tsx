import { useVirtualizer } from "@tanstack/react-virtual";
import { ScrollText } from "lucide-react";
import { useRef } from "react";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui";
import type { TaskLog } from "@/lib/api-types";
import { cn } from "@/lib/cn";
import { logLevelClass } from "@/lib/status";
import { formatAbsolute } from "@/lib/time";

interface JobLogsTabProps {
  logs: TaskLog[] | undefined;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
}

const ROW_ESTIMATE = 33;

export function JobLogsTab({ logs, loading, error, onRetry }: JobLogsTabProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const count = logs?.length ?? 0;

  // Rows wrap to arbitrary heights (full, un-truncated messages), so we measure
  // each rendered row instead of trusting a fixed estimate. Only the visible
  // slice mounts, keeping a job's hundreds of log lines smooth to scroll.
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_ESTIMATE,
    overscan: 10,
  });

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
    <div
      ref={parentRef}
      className="max-h-[560px] overflow-auto rounded-lg bg-[var(--surface)] ring-1 ring-inset ring-[var(--border)]"
    >
      <div
        style={{ height: virtualizer.getTotalSize(), width: "100%", position: "relative" }}
        className="font-mono text-[11px]"
      >
        {virtualizer.getVirtualItems().map((item) => {
          const log = logs[item.index];
          if (!log) return null;
          const levelClass = logLevelClass(log.level);
          return (
            <div
              key={`${log.logged_at}-${log.level}-${item.index}`}
              ref={virtualizer.measureElement}
              data-index={item.index}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${item.start}px)`,
              }}
              className="flex gap-3 border-b border-[var(--border)] px-4 py-2 hover:bg-[var(--surface-2)]/60"
            >
              <span className="shrink-0 text-[var(--fg-subtle)]">
                {formatAbsolute(log.logged_at)}
              </span>
              <span className={cn("shrink-0 uppercase", levelClass)}>{log.level}</span>
              <span className="flex-1 whitespace-pre-wrap break-words text-[var(--fg)]">
                {log.message}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
