import { cn } from "@/lib/cn";
import { TONE_VAR, type Tone } from "@/lib/status";

interface MeterBarProps {
  /** 0–100. Clamped. */
  value: number;
  tone?: Tone;
  height?: number;
  className?: string;
}

/** A single-value progress bar tinted by tone (gauges, success rates, pools). */
export function MeterBar({ value, tone = "info", height = 6, className }: MeterBarProps) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      className={cn("overflow-hidden rounded-full bg-[var(--surface-3)]", className)}
      style={{ height }}
    >
      <span
        className="block h-full rounded-full"
        style={{ width: `${pct}%`, background: TONE_VAR[tone] }}
      />
    </div>
  );
}
