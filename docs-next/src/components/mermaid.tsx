"use client";

import { useTheme } from "next-themes";
import { useEffect, useId, useRef, useState } from "react";

export function Mermaid({ chart }: { chart: string }) {
  const id = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();
  const [svg, setSvg] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const mermaid = (await import("mermaid")).default;
      mermaid.initialize({
        startOnLoad: false,
        theme: resolvedTheme === "dark" ? "dark" : "default",
        securityLevel: "loose",
        fontFamily: "inherit",
      });
      try {
        const renderId = `m${id.replace(/[^a-zA-Z0-9]/g, "")}`;
        const { svg: rendered } = await mermaid.render(renderId, chart);
        if (!cancelled) {
          setSvg(rendered);
        }
      } catch (err) {
        if (!cancelled) {
          setSvg(`<pre>Mermaid render error: ${(err as Error).message}</pre>`);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chart, id, resolvedTheme]);

  return (
    <div
      ref={containerRef}
      className="my-4 flex justify-center [&_svg]:max-w-full"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid produces trusted SVG from author content
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
