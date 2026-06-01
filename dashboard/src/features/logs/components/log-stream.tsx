import { useVirtualizer } from "@tanstack/react-virtual";
import { ScrollText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui";
import type { TaskLog } from "@/lib/api-types";
import { cn } from "@/lib/cn";
import { logLevelClass } from "@/lib/status";

/** Wall-clock time only (24h), to match the live-tail row density. */
function formatLogTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-US", { hour12: false });
}

interface LogStreamProps {
  logs: TaskLog[] | undefined;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
  className?: string;
}

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
    return (
      <div className="p-[var(--pad)]">
        <ErrorState title="Couldn't load logs" description={error.message} onRetry={onRetry} />
      </div>
    );
  }

  if (loading && !logs) {
    return <Skeleton className="m-[var(--pad)] h-96" />;
  }

  if (!logs || logs.length === 0) {
    return (
      <div className="p-[var(--pad)]">
        <EmptyState
          icon={ScrollText}
          title="No logs match this filter"
          description="Try widening the time range or clearing the task filter."
        />
      </div>
    );
  }

  return (
    <div className={cn("relative", className)}>
      <div
        ref={parentRef}
        onScroll={handleScroll}
        className="h-[560px] overflow-auto rounded-[var(--card-radius)]"
      >
        <div style={{ height: virtualizer.getTotalSize(), width: "100%", position: "relative" }}>
          {virtualizer.getVirtualItems().map((item) => {
            const log = logs[item.index];
            if (!log) return null;
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
                className="flex items-center gap-3 px-4 py-1 text-[0.78rem] hover:bg-[var(--surface-2)]/50"
              >
                <span className="shrink-0 font-mono tabular-nums text-[var(--fg-subtle)]">
                  {formatLogTime(log.logged_at)}
                </span>
                <span
                  className={cn(
                    "inline-flex w-[58px] shrink-0 justify-center rounded-[var(--chip-radius)] bg-current/10 px-1.5 py-0.5 text-[0.62rem] font-semibold uppercase tracking-[0.08em]",
                    logLevelClass(log.level),
                  )}
                >
                  {log.level}
                </span>
                <span className="w-[168px] shrink-0 truncate font-mono text-[var(--accent-ink)]">
                  {log.task_name}
                </span>
                <span className="flex-1 truncate text-[var(--fg)]">
                  {log.message}
                  {log.extra ? (
                    <span className="ml-1.5 font-mono text-[var(--fg-subtle)]">{log.extra}</span>
                  ) : null}
                </span>
                <span className="ml-auto shrink-0 font-mono text-[var(--fg-subtle)]">
                  {log.job_id.slice(0, 6)}
                </span>
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
