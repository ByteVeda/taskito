import { highlight as fumaHighlight } from "fumadocs-core/highlight";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type HighlightLang = "python" | "bash" | "tsx" | "ts" | "json" | "yaml";

const DEFAULT_PRE_CLASSES =
  "p-5 text-sm leading-relaxed overflow-x-auto bg-fd-card";

export async function highlight(
  code: string,
  lang: HighlightLang,
  preClassName?: string,
): Promise<ReactNode> {
  return fumaHighlight(code, {
    lang,
    themes: {
      light: "github-light",
      dark: "github-dark",
    },
    components: {
      pre: ({ children, className, ...props }) => (
        <pre
          {...props}
          className={cn(DEFAULT_PRE_CLASSES, className, preClassName)}
        >
          {children}
        </pre>
      ),
    },
  });
}
