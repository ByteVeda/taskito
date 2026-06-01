import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type CalloutTone = "warning" | "info" | "danger";

const TONE: Record<CalloutTone, string> = {
  warning: "bg-warning-dim border-warning/30 [&_svg]:text-warning",
  info: "bg-info-dim border-info/30 [&_svg]:text-info",
  danger: "bg-danger-dim border-danger/30 [&_svg]:text-danger",
};

interface CalloutProps {
  tone?: CalloutTone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** An inline tinted note with a leading icon — security warnings, hints. */
export function Callout({ tone = "warning", icon, children, className }: CalloutProps) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-[var(--btn-radius)] border px-3.5 py-3 text-[0.82rem] leading-relaxed text-[var(--fg)] [&_svg]:mt-px [&_svg]:size-4 [&_svg]:shrink-0",
        TONE[tone],
        className,
      )}
    >
      {icon}
      <span>{children}</span>
    </div>
  );
}
