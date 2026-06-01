import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Segmented,
  type SegmentedOption,
} from "@/components/ui";
import { type RefreshOption, useRefreshInterval } from "@/providers";
import { SettingRow } from "./setting-row";

const OPTIONS: Array<{ value: RefreshOption; label: string; hint: string }> = [
  { value: "2s", label: "2s", hint: "Aggressive — best for live debugging" },
  { value: "5s", label: "5s", hint: "Balanced (default)" },
  { value: "10s", label: "10s", hint: "Light — fewer requests" },
  { value: "off", label: "Off", hint: "Refresh manually only" },
];

const SEGMENTS: SegmentedOption<RefreshOption>[] = OPTIONS.map(({ value, label }) => ({
  value,
  label,
}));

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
        <CardTitle>Dashboard</CardTitle>
        <CardDescription>How often the dashboard re-polls the backend for updates.</CardDescription>
      </CardHeader>
      <CardContent>
        <SettingRow label="Auto-refresh" description={hint}>
          <Segmented
            options={SEGMENTS}
            value={option}
            onChange={setOption}
            aria-label="Refresh interval"
          />
        </SettingRow>
      </CardContent>
    </Card>
  );
}
