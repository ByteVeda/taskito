import { cn } from "@/lib/cn";
import { TIME_RANGES, type TimeRange } from "../types";

interface TimeRangeSelectorProps {
  value: TimeRange;
  onChange: (v: TimeRange) => void;
  className?: string;
}

export function TimeRangeSelector({ value, onChange, className }: TimeRangeSelectorProps) {
  return (
    <div
      role="toolbar"
      aria-label="Time range"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md bg-[var(--surface-2)] p-0.5 ring-1 ring-inset ring-[var(--border)]",
        className,
      )}
    >
      {TIME_RANGES.map((r) => {
        const active = r.value === value;
        return (
          <button
            key={r.value}
            type="button"
            onClick={() => onChange(r.value)}
            aria-pressed={active}
            className={cn(
              "rounded-sm px-2 py-1 text-xs font-medium transition-colors",
              active
                ? "bg-[var(--surface)] text-[var(--fg)] shadow-xs"
                : "text-[var(--fg-subtle)] hover:text-[var(--fg)]",
            )}
          >
            {r.value}
          </button>
        );
      })}
    </div>
  );
}
