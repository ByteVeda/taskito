import { useEffect, useId, useRef, useState } from "react";
import {
  applyDiagramTheme,
  diagramThemeCss,
  diagramThemeVariables,
} from "@/lib/mermaid-theme";
import { useThemeMode } from "@/lib/theme";

export function Mermaid({ chart }: { chart: string }) {
  const id = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const resolvedTheme = useThemeMode();
  const [svg, setSvg] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const mermaid = (await import("mermaid")).default;
      if (typeof document !== "undefined" && document.fonts?.ready) {
        await document.fonts.ready;
      }
      const theme = resolvedTheme === "dark" ? "dark" : "light";
      mermaid.initialize({
        startOnLoad: false,
        theme: "base",
        themeVariables: diagramThemeVariables(theme),
        themeCSS: diagramThemeCss(theme),
        securityLevel: "loose",
        fontFamily: '"IBM Plex Sans", "Inter", system-ui, sans-serif',
        flowchart: { padding: 18, htmlLabels: true, useMaxWidth: true },
        sequence: {
          actorFontFamily: '"IBM Plex Sans", sans-serif',
          noteFontFamily: '"IBM Plex Sans", sans-serif',
          messageFontFamily: '"IBM Plex Sans", sans-serif',
        },
      });
      try {
        const renderId = `m${id.replace(/[^a-zA-Z0-9]/g, "")}`;
        const { svg: rendered } = await mermaid.render(
          renderId,
          applyDiagramTheme(chart, theme),
        );
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
      className="my-6 flex justify-center [&_svg]:max-w-full"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid produces trusted SVG from author content
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
