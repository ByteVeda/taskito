import type { ElementType } from "react";

/** Render trusted HTML (our own syntax highlighter / static prototype copy).
 *  Single chokepoint for the dangerouslySetInnerHTML suppression. */
export function RawHtml({
  as,
  html,
  className,
}: {
  as?: ElementType;
  html: string;
  className?: string;
}) {
  const Tag = as ?? "div";
  return (
    <Tag
      className={className}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted build-time tokens / static copy
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
