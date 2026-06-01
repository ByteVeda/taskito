import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-[var(--chip-radius)] border px-2.5 py-0.5 text-[0.74rem] font-medium whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "bg-[var(--surface-3)] text-[var(--fg-muted)] border-[var(--border-strong)]",
        accent: "bg-accent-dim text-accent-ink border-accent/30",
        info: "bg-info-dim text-info border-info/30",
        success: "bg-success-dim text-success border-success/30",
        warning: "bg-warning-dim text-warning border-warning/30",
        danger: "bg-danger-dim text-danger border-danger/30",
      },
    },
    defaultVariants: {
      tone: "neutral",
    },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  /** Render a small leading dot in the badge's own color (status pills). */
  dot?: boolean;
}

export function Badge({ className, tone, dot, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props}>
      {dot ? <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden /> : null}
      {children}
    </span>
  );
}

export { badgeVariants };
