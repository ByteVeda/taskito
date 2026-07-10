import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  // Inline diagrams fit the column; clicking opens a full-viewport overlay where
  // the chart renders large (already "zoomed in") — readable without an inline
  // scrollbar. Click anywhere or press Escape to close.
  const [zoomed, setZoomed] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLButtonElement>(null);

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

  useEffect(() => {
    if (!zoomed) {
      return;
    }
    // Move focus into the overlay so the keyboard isn't stranded on the
    // now-hidden trigger; restore it to the trigger on close.
    const trigger = triggerRef.current;
    modalRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setZoomed(false);
      } else if (event.key === "Tab") {
        // The overlay is the only focusable element — trap Tab on it so
        // focus can't reach background controls behind the modal.
        event.preventDefault();
        modalRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      trigger?.focus();
    };
  }, [zoomed]);

  // Only one SVG is in the DOM per state (inline OR overlay), so there's no
  // duplicate-id copy to break the arrowhead/marker `url(#…)` references.
  return (
    <>
      {!zoomed && (
        <button
          ref={triggerRef}
          type="button"
          className="mermaid-fig"
          aria-label="Enlarge diagram"
          onClick={() => setZoomed(true)}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid produces trusted SVG from author content
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}
      {zoomed &&
        createPortal(
          <button
            ref={modalRef}
            type="button"
            className="mermaid-modal"
            aria-label="Close enlarged diagram"
            onClick={() => setZoomed(false)}
            // biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid produces trusted SVG from author content
            dangerouslySetInnerHTML={{ __html: svg }}
          />,
          document.body,
        )}
    </>
  );
}
