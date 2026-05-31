import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface SectionHeadingProps {
  title: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** A serif section title with an optional right-aligned action. */
export function SectionHeading({ title, action, className }: SectionHeadingProps) {
  return (
    <div className={cn("mb-3 flex min-h-[30px] items-center justify-between gap-3", className)}>
      <h2 className="font-serif text-[1.18rem] font-semibold tracking-[-0.01em] whitespace-nowrap text-[var(--fg)]">
        {title}
      </h2>
      {action ?? null}
    </div>
  );
}
