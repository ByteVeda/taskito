import { cn } from "@/lib/cn";
import { type RefreshOption, useRefreshInterval } from "@/providers";

const OPTIONS: RefreshOption[] = ["2s", "5s", "10s", "off"];

export function RefreshControl() {
  const { option, setOption } = useRefreshInterval();
  return (
    <div
      role="toolbar"
      aria-label="Refresh interval"
      className="inline-flex items-center gap-0.5 rounded-md bg-[var(--surface-2)] p-0.5 ring-1 ring-inset ring-[var(--border)]"
    >
      {OPTIONS.map((value) => {
        const active = option === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => setOption(value)}
            aria-pressed={active}
            className={cn(
              "rounded-sm px-2 py-1 text-xs font-medium transition-colors",
              active
                ? "bg-[var(--surface)] text-[var(--fg)] shadow-xs"
                : "text-[var(--fg-subtle)] hover:text-[var(--fg)]",
            )}
          >
            {value === "off" ? "Off" : value}
          </button>
        );
      })}
    </div>
  );
}
