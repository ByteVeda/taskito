import { Info, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

type CalloutType = "info" | "warn" | "warning" | "error" | string;

const VARIANT: Record<string, { cls: string; Icon: typeof Info }> = {
  info: { cls: "info", Icon: Info },
  warn: { cls: "warn", Icon: TriangleAlert },
  warning: { cls: "warn", Icon: TriangleAlert },
  error: { cls: "warn", Icon: TriangleAlert },
};

/** Design-matched replacement for `fumadocs-ui/components/callout` (aliased in vite). */
export function Callout({
  title,
  type,
  children,
}: {
  title?: string;
  type?: CalloutType;
  children?: ReactNode;
}) {
  const variant = VARIANT[type ?? ""] ?? { cls: "", Icon: Info };
  const Icon = variant.Icon;
  return (
    <div className={`callout ${variant.cls}`.trim()}>
      <span className="ci" aria-hidden="true">
        <Icon size={18} />
      </span>
      <div className="cc">
        {title ? <strong className="ctitle">{title}</strong> : null}
        {children}
      </div>
    </div>
  );
}

export default Callout;
