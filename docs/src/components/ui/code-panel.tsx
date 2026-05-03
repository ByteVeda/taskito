import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type CodePanelTone = "primary" | "muted" | "default";

const TONE_CLASSES: Record<CodePanelTone, string> = {
  primary: "border-t-2 border-t-fd-primary",
  muted: "border-t-2 border-t-fd-border",
  default: "",
};

const LABEL_TONE_CLASSES: Record<CodePanelTone, string> = {
  primary: "text-fd-primary",
  muted: "text-fd-foreground",
  default: "text-fd-foreground",
};

type LabelHeader = {
  label: string;
  caption?: string;
  header?: undefined;
};

type CustomHeader = {
  label?: undefined;
  caption?: undefined;
  header: ReactNode;
};

type NoHeader = {
  label?: undefined;
  caption?: undefined;
  header?: undefined;
};

export type CodePanelProps = {
  tone?: CodePanelTone;
  className?: string;
  children: ReactNode;
} & (LabelHeader | CustomHeader | NoHeader);

export function CodePanel(props: CodePanelProps) {
  const { tone = "default", className, children } = props;

  return (
    <div
      className={cn(
        "rounded-lg border border-fd-border bg-fd-card overflow-hidden",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {renderHeader(props)}
      {children}
    </div>
  );
}

function renderHeader(props: CodePanelProps) {
  if (props.header !== undefined) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 border-b border-fd-border bg-fd-muted">
        {props.header}
      </div>
    );
  }
  if (props.label !== undefined) {
    const tone = props.tone ?? "default";
    return (
      <div className="flex items-baseline justify-between px-4 py-3 border-b border-fd-border bg-fd-muted">
        <span className={cn("text-sm font-semibold", LABEL_TONE_CLASSES[tone])}>
          {props.label}
        </span>
        {props.caption ? (
          <span className="text-xs text-fd-muted-foreground">
            {props.caption}
          </span>
        ) : null}
      </div>
    );
  }
  return null;
}
