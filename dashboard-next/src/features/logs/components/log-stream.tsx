import { useVirtualizer } from "@tanstack/react-virtual";
import { ScrollText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import type { TaskLog } from "@/lib/api-types";
import { cn } from "@/lib/cn";
import { formatAbsolute } from "@/lib/time";

interface LogStreamProps {
  logs: TaskLog[] | undefined;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
  className?: string;
}

const LEVEL_TONE: Record<string, string> = {
  error: "text-danger",
  warning: "text-warning",
  warn: "text-warning",
  info: "text-info",
  debug: "text-[var(--fg-subtle)]",
};

const ROW_ESTIMATE = 28;
const AUTO_SCROLL_THRESHOLD_PX = 40;

/**
 * Live-tail log stream.
 *
 * Rows are virtualized via `@tanstack/react-virtual` — only the visible slice
 * is mounted, so rendering 5000+ log lines stays smooth. Auto-scroll sticks
 * the viewport to the newest row; if the user scrolls up past a threshold
 * we disengage auto-scroll until they return to the bottom.
 */
export function LogStream({ logs, loading, error, onRetry, className }: LogStreamProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const count = logs?.length ?? 0;
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_ESTIMATE,
    overscan: 12,
  });

  // Stick to the bottom whenever new rows arrive and the user hasn't
  // scrolled away from it.
  useEffect(() => {
    if (!autoScroll || count === 0) return;
    virtualizer.scrollToIndex(count - 1, { align: "end" });
  }, [count, autoScroll, virtualizer]);

  const handleScroll = () => {
    const el = parentRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - (el.scrollTop + el.clientHeight);
    setAutoScroll(distanceFromBottom < AUTO_SCROLL_THRESHOLD_PX);
  };

  if (error) {
    return <ErrorState title="Couldn't load logs" description={error.message} onRetry={onRetry} />;
  }

  if (loading && !logs) {
    return <Skeleton className="h-96 w-full" />;
  }

  if (!logs || logs.length === 0) {
    return (
      <EmptyState
        icon={ScrollText}
        title="No logs match this filter"
        description="Try widening the time range or clearing the task filter."
      />
    );
  }

  return (
    <div className={cn("relative", className)}>
      <div
        ref={parentRef}
        onScroll={handleScroll}
        className="h-[560px] overflow-auto rounded-lg bg-[var(--surface)] ring-1 ring-inset ring-[var(--border)]"
      >
        <div style={{ height: virtualizer.getTotalSize(), width: "100%", position: "relative" }}>
          {virtualizer.getVirtualItems().map((item) => {
            const log = logs[item.index];
            if (!log) return null;
            const levelClass = LEVEL_TONE[log.level.toLowerCase()] ?? "text-[var(--fg-muted)]";
            return (
              <div
                key={`${log.logged_at}-${log.job_id}-${item.index}`}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  transform: `translateY(${item.start}px)`,
                }}
                className="flex gap-3 px-4 py-1 font-mono text-[11px] hover:bg-[var(--surface-2)]/40"
              >
                <span className="shrink-0 text-[var(--fg-subtle)]">
                  {formatAbsolute(log.logged_at * 1000)}
                </span>
                <span className={cn("w-14 shrink-0 uppercase", levelClass)}>{log.level}</span>
                <span className="w-40 shrink-0 truncate text-[var(--fg-muted)]">
                  {log.task_name}
                </span>
                <span className="flex-1 truncate text-[var(--fg)]">{log.message}</span>
              </div>
            );
          })}
        </div>
      </div>
      {!autoScroll ? (
        <button
          type="button"
          onClick={() => {
            setAutoScroll(true);
            virtualizer.scrollToIndex(count - 1, { align: "end" });
          }}
          className="absolute bottom-3 right-3 rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-fg shadow-lg hover:bg-accent/90"
        >
          Jump to latest
        </button>
      ) : null}
    </div>
  );
}
