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

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

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
