import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Card } from "./card";
import { type StatTrend, trendToneClass } from "./stat-card-trend";

export type { StatTrend, TrendDirection } from "./stat-card-trend";

type StatTone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

interface StatCardProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  trend?: StatTrend;
  sparkline?: ReactNode;
  tone?: StatTone;
}

/** Tinted icon chip — the icon's color plus its faint background tint. */
const TONE_CHIP: Record<StatTone, string> = {
  neutral: "bg-[var(--surface-2)] text-[var(--fg-muted)]",
  accent: "bg-accent-dim text-accent",
  info: "bg-info-dim text-info",
  success: "bg-success-dim text-success",
  warning: "bg-warning-dim text-warning",
  danger: "bg-danger-dim text-danger",
};

const TREND_ICON: Record<StatTrend["direction"], typeof ArrowUp> = {
  up: ArrowUp,
  down: ArrowDown,
  flat: Minus,
};

export const StatCard = forwardRef<HTMLDivElement, StatCardProps>(
  ({ label, value, hint, icon, trend, sparkline, tone = "neutral", className, ...props }, ref) => {
    const TrendIcon = trend ? TREND_ICON[trend.direction] : null;
    const trendClass = trend ? trendToneClass(trend.direction, trend.upIsGood ?? true) : "";
    return (
      <Card
        ref={ref}
        className={cn(
          "flex flex-col overflow-hidden p-[var(--pad)] transition-shadow hover:shadow-[var(--card-hover-shadow)]",
          className,
        )}
        {...props}
      >
        <div className="flex items-center justify-between">
          <div className="text-[length:var(--label-size)] font-medium tracking-[0.005em] text-[var(--fg-muted)]">
            {label}
          </div>
          {icon ? (
            <span
              className={cn(
                "grid size-[30px] shrink-0 place-items-center rounded-[9px] [&_svg]:size-4",
                TONE_CHIP[tone],
              )}
            >
              {icon}
            </span>
          ) : null}
        </div>
        <div className="mt-3.5 flex items-baseline gap-2">
          <div className="font-mono text-[length:var(--stat-size)] font-semibold leading-[1.05] tracking-[-0.03em] tabular-nums whitespace-nowrap">
            {value}
          </div>
          {trend && TrendIcon ? (
            <span
              className={cn("inline-flex items-center gap-0.5 text-xs font-semibold", trendClass)}
            >
              <TrendIcon className="size-3" aria-hidden />
              <span className="sr-only">Trend {trend.direction}:</span>
              <span className="tabular-nums">{trend.label}</span>
            </span>
          ) : null}
        </div>
        {hint ? <div className="mt-1 text-xs text-[var(--fg-subtle)]">{hint}</div> : null}
        {sparkline ? <div className="mt-3">{sparkline}</div> : null}
      </Card>
    );
  },
);
StatCard.displayName = "StatCard";
