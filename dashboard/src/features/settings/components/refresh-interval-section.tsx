import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { cn } from "@/lib/cn";
import { type RefreshOption, useRefreshInterval } from "@/providers";
import { SettingRow } from "./setting-row";

const OPTIONS: Array<{ value: RefreshOption; label: string; hint: string }> = [
  { value: "2s", label: "2s", hint: "Aggressive — best for live debugging" },
  { value: "5s", label: "5s", hint: "Balanced (default)" },
  { value: "10s", label: "10s", hint: "Light — fewer requests" },
  { value: "off", label: "Off", hint: "Refresh manually only" },
];

/**
 * Auto-refresh interval for all polled queries. Persisted to ``localStorage``
 * via the ``RefreshIntervalProvider`` — no server round-trip.
 */
export function RefreshIntervalSection() {
  const { option, setOption } = useRefreshInterval();
  const current = OPTIONS.find((o) => o.value === option);
  const hint = current?.hint ?? "Balanced (default)";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Refresh interval</CardTitle>
        <CardDescription>How often the dashboard re-polls the backend for updates.</CardDescription>
      </CardHeader>
      <CardContent>
        <SettingRow label="Polling cadence" description={hint} htmlFor="refresh-interval">
          <div
            id="refresh-interval"
            role="toolbar"
            aria-label="Refresh interval"
            className="inline-flex items-center gap-0.5 rounded-md bg-[var(--surface-2)] p-0.5 ring-1 ring-inset ring-[var(--border)]"
          >
            {OPTIONS.map(({ value, label }) => {
              const active = option === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setOption(value)}
                  className={cn(
                    "rounded-sm px-3 py-1 text-xs font-medium transition-colors",
                    active
                      ? "bg-[var(--surface)] text-[var(--fg)] shadow-xs"
                      : "text-[var(--fg-subtle)] hover:text-[var(--fg)]",
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </SettingRow>
      </CardContent>
    </Card>
  );
}
