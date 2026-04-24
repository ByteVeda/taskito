import { AlertTriangle, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Button } from "./button";

interface ErrorStateProps {
  icon?: LucideIcon;
  title?: string;
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
  action?: ReactNode;
  className?: string;
}

export function ErrorState({
  icon: Icon = AlertTriangle,
  title = "Something went wrong",
  description,
  onRetry,
  retryLabel = "Retry",
  action,
  className,
}: ErrorStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-danger/40 bg-danger-dim/30 px-6 py-10 text-center",
        className,
      )}
    >
      <div className="grid size-10 place-items-center rounded-full bg-danger-dim text-danger">
        <Icon className="size-5" aria-hidden />
      </div>
      <div>
        <div className="text-sm font-medium text-[var(--fg)]">{title}</div>
        {description ? (
          <div className="mt-1 text-xs text-[var(--fg-muted)]">{description}</div>
        ) : null}
      </div>
      {action ??
        (onRetry ? (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            {retryLabel}
          </Button>
        ) : null)}
    </div>
  );
}
