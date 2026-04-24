import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";

interface StatCardProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  trend?: "up" | "down" | "flat";
  tone?: "neutral" | "accent" | "success" | "warning" | "danger" | "info";
}

const TONE_RING: Record<NonNullable<StatCardProps["tone"]>, string> = {
  neutral: "text-[var(--fg-muted)]",
  accent: "text-accent",
  info: "text-info",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
};

export const StatCard = forwardRef<HTMLDivElement, StatCardProps>(
  ({ label, value, hint, icon, tone = "neutral", className, ...props }, ref) => (
    <Card ref={ref} className={cn("px-5 py-4", className)} {...props}>
      <div className="flex items-start justify-between">
        <div className="text-xs font-medium uppercase tracking-wide text-[var(--fg-subtle)]">
          {label}
        </div>
        {icon ? <div className={cn("shrink-0", TONE_RING[tone])}>{icon}</div> : null}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
      {hint ? <div className="mt-1 text-xs text-[var(--fg-subtle)]">{hint}</div> : null}
    </Card>
  ),
);
StatCard.displayName = "StatCard";
