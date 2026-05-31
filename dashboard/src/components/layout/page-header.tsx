import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Breadcrumbs, type Crumb } from "./breadcrumbs";

interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: Crumb[];
  className?: string;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  breadcrumbs,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "mb-[22px] flex flex-col gap-3 md:flex-row md:items-end md:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        {breadcrumbs && breadcrumbs.length > 0 ? (
          <Breadcrumbs items={breadcrumbs} className="mb-2" />
        ) : eyebrow ? (
          <div className="mb-1.5 font-mono text-[0.68rem] font-semibold uppercase tracking-[0.13em] text-[var(--accent-ink)]">
            {eyebrow}
          </div>
        ) : null}
        <h1 className="font-serif text-[2rem] font-semibold leading-[1.05] tracking-[-0.02em] text-[var(--fg)]">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 max-w-[60ch] text-[0.92rem] text-[var(--fg-muted)]">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2.5">{actions}</div> : null}
    </div>
  );
}
