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

const TONE_RING: Record<StatTone, string> = {
  neutral: "text-[var(--fg-muted)]",
  accent: "text-accent",
  info: "text-info",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
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
      <Card ref={ref} className={cn("flex flex-col px-5 py-4", className)} {...props}>
        <div className="flex items-start justify-between">
          <div className="text-xs font-medium uppercase tracking-wide text-[var(--fg-subtle)]">
            {label}
          </div>
          {icon ? <div className={cn("shrink-0", TONE_RING[tone])}>{icon}</div> : null}
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <div className="text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
          {trend && TrendIcon ? (
            <span
              className={cn("inline-flex items-center gap-0.5 text-xs font-medium", trendClass)}
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
