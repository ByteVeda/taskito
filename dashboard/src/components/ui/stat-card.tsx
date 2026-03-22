import type { LucideIcon } from "lucide-preact";
import { Ban, CheckCircle2, Clock, Play, Skull, XCircle } from "lucide-preact";
import { fmtNumber } from "../../lib";

interface StatCardProps {
  label: string;
  value: number;
  color?: string;
}

const STAT_CONFIG: Record<string, { color: string; bg: string; border: string; icon: LucideIcon }> =
  {
    pending: {
      color: "text-warning",
      bg: "bg-warning-dim",
      border: "border-l-warning",
      icon: Clock,
    },
    running: { color: "text-info", bg: "bg-info-dim", border: "border-l-info", icon: Play },
    completed: {
      color: "text-success",
      bg: "bg-success-dim",
      border: "border-l-success",
      icon: CheckCircle2,
    },
    failed: { color: "text-danger", bg: "bg-danger-dim", border: "border-l-danger", icon: XCircle },
    dead: { color: "text-danger", bg: "bg-danger-dim", border: "border-l-danger", icon: Skull },
    cancelled: { color: "text-muted", bg: "bg-muted/10", border: "border-l-muted/40", icon: Ban },
  };

export function StatCard({ label, value, color }: StatCardProps) {
  const config = STAT_CONFIG[label];
  const textColor = color ?? config?.color ?? "text-accent-light";
  const bg = config?.bg ?? "bg-accent-dim";
  const border = config?.border ?? "border-l-accent";
  const Icon = config?.icon ?? Clock;

  return (
    <div
      class={`dark:bg-surface-2 bg-white rounded-xl p-5 shadow-sm dark:shadow-black/20 border-l-[3px] ${border} dark:border-t dark:border-r dark:border-b dark:border-white/[0.04] border border-slate-100 transition-all duration-150 hover:shadow-md hover:dark:shadow-black/30`}
    >
      <div class="flex items-start justify-between">
        <div>
          <div class={`text-3xl font-bold tabular-nums tracking-tight ${textColor}`}>
            {fmtNumber(value)}
          </div>
          <div class="text-xs text-muted uppercase mt-1.5 tracking-wider font-medium">{label}</div>
        </div>
        <div class={`p-2 rounded-lg ${bg}`}>
          <Icon class={`w-5 h-5 ${textColor}`} strokeWidth={1.8} />
        </div>
      </div>
    </div>
  );
}
