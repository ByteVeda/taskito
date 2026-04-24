import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface Crumb {
  label: ReactNode;
  to?: string;
}

interface BreadcrumbsProps {
  items: Crumb[];
  className?: string;
}

export function Breadcrumbs({ items, className }: BreadcrumbsProps) {
  if (items.length === 0) return null;
  return (
    <nav
      aria-label="Breadcrumb"
      className={cn("flex items-center gap-1.5 text-xs text-[var(--fg-subtle)]", className)}
    >
      {items.map((item, i) => {
        const last = i === items.length - 1;
        const key = `${item.to ?? ""}-${i}`;
        return (
          <span key={key} className="inline-flex items-center gap-1.5">
            {item.to && !last ? (
              <Link to={item.to} className="transition-colors hover:text-[var(--fg)]">
                {item.label}
              </Link>
            ) : (
              <span className={cn(last && "text-[var(--fg)]")}>{item.label}</span>
            )}
            {!last ? <ChevronRight className="size-3 text-[var(--fg-subtle)]" aria-hidden /> : null}
          </span>
        );
      })}
    </nav>
  );
}
