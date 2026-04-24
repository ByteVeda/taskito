import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-[var(--border-strong)] bg-[var(--surface)] px-6 py-12 text-center",
        className,
      )}
    >
      {Icon ? (
        <div className="grid size-10 place-items-center rounded-full bg-[var(--surface-2)] text-[var(--fg-muted)]">
          <Icon className="size-5" aria-hidden />
        </div>
      ) : null}
      <div>
        <div className="text-sm font-medium text-[var(--fg)]">{title}</div>
        {description ? (
          <div className="mt-1 text-xs text-[var(--fg-muted)]">{description}</div>
        ) : null}
      </div>
      {action}
    </div>
  );
}
