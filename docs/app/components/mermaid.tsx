import { useEffect, useId, useState } from "react";
import {
  applyDiagramTheme,
  diagramThemeCss,
  diagramThemeVariables,
} from "@/lib/mermaid-theme";
import { useThemeMode } from "@/lib/theme";

export function Mermaid({ chart }: { chart: string }) {
  const id = useId();
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
        // useMaxWidth:false renders at natural size instead of shrinking wide
        // LR charts to fit — a scroll wrapper (below) keeps the text readable.
        flowchart: { padding: 18, htmlLabels: true, useMaxWidth: false },
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

  // Outer scrolls when the natural-size diagram is wider than the column; the
  // `mx-auto w-fit` inner centers narrow diagrams and never clips the left edge
  // of a wide one (unlike flex centering, which makes overflow unreachable).
  return (
    <div className="my-6 overflow-x-auto">
      <div
        className="mx-auto w-fit"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid produces trusted SVG from author content
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );
}
