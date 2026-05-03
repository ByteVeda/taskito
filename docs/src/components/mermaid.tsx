"use client";

import { useTheme } from "next-themes";
import { useEffect, useId, useRef, useState } from "react";

const DARK_THEME_VARIABLES = {
  darkMode: true,
  background: "transparent",
  primaryColor: "#1f2024",
  primaryTextColor: "#f5f5f7",
  primaryBorderColor: "#7a7d85",
  lineColor: "#9b9ea6",
  secondaryColor: "#2a2c31",
  tertiaryColor: "#26282d",
  mainBkg: "#1f2024",
  nodeBkg: "#1f2024",
  nodeBorder: "#7a7d85",
  clusterBkg: "#1a1b1e",
  clusterBorder: "#5a5d65",
  edgeLabelBackground: "#2a2c31",
  titleColor: "#f5f5f7",
  labelTextColor: "#f5f5f7",
  textColor: "#f5f5f7",
  noteBkgColor: "#3a3c41",
  noteTextColor: "#f5f5f7",
  noteBorderColor: "#7a7d85",
  errorBkgColor: "#4a1d1d",
  errorTextColor: "#fca5a5",
  // erDiagram-specific (entity attribute rows) — same color, no zebra stripe
  attributeBackgroundColorOdd: "#1f2024",
  attributeBackgroundColorEven: "#1f2024",
  // stateDiagram-specific
  altBackground: "#26282d",
  // flowchart label colors
  labelBackground: "#2a2c31",
  // sequenceDiagram
  actorBkg: "#1f2024",
  actorBorder: "#7a7d85",
  actorTextColor: "#f5f5f7",
  actorLineColor: "#9b9ea6",
  signalColor: "#f5f5f7",
  signalTextColor: "#f5f5f7",
  labelBoxBkgColor: "#2a2c31",
  labelBoxBorderColor: "#7a7d85",
  loopTextColor: "#f5f5f7",
  activationBkgColor: "#3a3c41",
  activationBorderColor: "#9b9ea6",
} as const;

const DARK_THEME_CSS = `
  .er.entityBox { fill: #1f2024 !important; stroke: #7a7d85 !important; }
  .er.entityLabel { fill: #f5f5f7 !important; }
  .er.attributeBoxOdd { fill: #1f2024 !important; }
  .er.attributeBoxEven { fill: #1f2024 !important; }
  .er .er.attribute-text,
  .er .attribute-text,
  .er text {
    fill: #f5f5f7 !important;
  }
  .er.relationshipLabel,
  .er.relationshipLabelBox {
    fill: #f5f5f7 !important;
  }
  .er.relationshipLabelBox + text { fill: #1a1a1a !important; }
`;

const LIGHT_THEME_CSS = `
  .er.entityBox { fill: #ffffff !important; stroke: #3a3a3a !important; }
  .er.entityLabel { fill: #1a1a1a !important; }
  .er.attributeBoxOdd { fill: #ffffff !important; }
  .er.attributeBoxEven { fill: #f4f4f5 !important; }
  .er .er.attribute-text,
  .er .attribute-text,
  .er text {
    fill: #1a1a1a !important;
  }
`;

const LIGHT_THEME_VARIABLES = {
  darkMode: false,
  background: "transparent",
  primaryColor: "#ffffff",
  primaryTextColor: "#1a1a1a",
  primaryBorderColor: "#3a3a3a",
  lineColor: "#4a4a4a",
  secondaryColor: "#f4f4f5",
  tertiaryColor: "#fafafa",
  mainBkg: "#ffffff",
  nodeBkg: "#ffffff",
  nodeBorder: "#3a3a3a",
  clusterBkg: "#f4f4f5",
  clusterBorder: "#a1a1aa",
  edgeLabelBackground: "#ffffff",
  titleColor: "#1a1a1a",
  labelTextColor: "#1a1a1a",
  textColor: "#1a1a1a",
  noteBkgColor: "#fef9c3",
  noteTextColor: "#1a1a1a",
  noteBorderColor: "#a1a1aa",
  // erDiagram-specific (entity attribute rows)
  attributeBackgroundColorOdd: "#ffffff",
  attributeBackgroundColorEven: "#f4f4f5",
  // stateDiagram-specific
  altBackground: "#f4f4f5",
  // flowchart label colors
  labelBackground: "#ffffff",
  // sequenceDiagram
  actorBkg: "#ffffff",
  actorBorder: "#3a3a3a",
  actorTextColor: "#1a1a1a",
  actorLineColor: "#4a4a4a",
  signalColor: "#1a1a1a",
  signalTextColor: "#1a1a1a",
  labelBoxBkgColor: "#ffffff",
  labelBoxBorderColor: "#3a3a3a",
  loopTextColor: "#1a1a1a",
  activationBkgColor: "#f4f4f5",
  activationBorderColor: "#4a4a4a",
} as const;

export function Mermaid({ chart }: { chart: string }) {
  const id = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();
  const [svg, setSvg] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const mermaid = (await import("mermaid")).default;
      if (typeof document !== "undefined" && document.fonts?.ready) {
        await document.fonts.ready;
      }
      const isDark = resolvedTheme === "dark";
      mermaid.initialize({
        startOnLoad: false,
        theme: "base",
        themeVariables: isDark ? DARK_THEME_VARIABLES : LIGHT_THEME_VARIABLES,
        themeCSS: isDark ? DARK_THEME_CSS : LIGHT_THEME_CSS,
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
      className="my-6 flex justify-center [&_svg]:max-w-full"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid produces trusted SVG from author content
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
