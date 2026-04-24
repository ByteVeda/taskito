import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ eyebrow, title, description, actions, className }: PageHeaderProps) {
  return (
    <div
      className={cn(
        "mb-6 flex flex-col gap-3 md:flex-row md:items-start md:justify-between",
        className,
      )}
    >
      <div>
        {eyebrow ? (
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-subtle)]">
            {eyebrow}
          </div>
        ) : null}
        <h1 className="text-xl font-semibold tracking-tight text-[var(--fg)]">{title}</h1>
        {description ? <p className="mt-1 text-sm text-[var(--fg-muted)]">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
