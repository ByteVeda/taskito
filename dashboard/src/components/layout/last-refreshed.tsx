import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useLastRefreshed } from "@/hooks";
import { cn } from "@/lib/cn";

function formatAgo(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function LastRefreshed({ className }: { className?: string }) {
  const { lastRefreshedAt, isFetching } = useLastRefreshed();
  const [, setTick] = useState(0);

  // Re-render only as often as the label can actually change: every second
  // while the "Ns ago" portion ticks, then minute- and hour-granularity once
  // the timestamp ages. Avoids a fixed 1s re-render forever.
  useEffect(() => {
    if (isFetching) return;
    let id: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const age = Date.now() - lastRefreshedAt;
      const delay = age < 60_000 ? 1_000 : age < 3_600_000 ? 60_000 : 3_600_000;
      id = setTimeout(() => {
        setTick((n) => n + 1);
        schedule();
      }, delay);
    };
    schedule();
    return () => clearTimeout(id);
  }, [isFetching, lastRefreshedAt]);

  const label = isFetching ? "Refreshing…" : `Updated ${formatAgo(Date.now() - lastRefreshedAt)}`;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs tabular-nums text-[var(--fg-subtle)]",
        className,
      )}
      aria-live="polite"
    >
      {isFetching ? (
        <Loader2 className="size-3 animate-spin text-accent" aria-hidden />
      ) : (
        <span aria-hidden className="size-1.5 rounded-full bg-success" />
      )}
      {label}
    </span>
  );
}
