import { cn } from "@/lib/cn";

type DotTone = "success" | "info" | "accent" | "warning" | "danger";

const TONE_TEXT: Record<DotTone, string> = {
  success: "text-success",
  info: "text-info",
  accent: "text-accent",
  warning: "text-warning",
  danger: "text-danger",
};

interface LiveDotProps {
  tone?: DotTone;
  /** Animate the pulsing ring. Off for static status dots. */
  pulse?: boolean;
  size?: number;
  className?: string;
}

/**
 * A small filled dot. With `pulse`, it emits an expanding ring (the "live"
 * signal). The ring is driven off `currentColor`, so the tone class sets both
 * the fill and the ring color.
 */
export function LiveDot({ tone = "success", pulse = true, size = 7, className }: LiveDotProps) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className={cn(
        "inline-block shrink-0 rounded-full bg-current",
        TONE_TEXT[tone],
        pulse && "pulse-ring",
        className,
      )}
    />
  );
}
