import { useEffect, useState } from "react";
import { useLocation } from "react-router";

interface Heading {
  id: string;
  text: string;
  level: number;
}

/** On-this-page TOC, built from the rendered article headings with scroll-spy. */
export function Toc() {
  const { pathname } = useLocation();
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [active, setActive] = useState<string>("");

  // Rebuild from the DOM after each page renders (headings carry ids from rehype-slug).
  useEffect(() => {
    const nodes = document.querySelectorAll<HTMLElement>(
      ".article h2[id], .article h3[id]",
    );
    setHeadings(
      [...nodes].map((el) => ({
        id: el.id,
        text: el.textContent ?? "",
        level: el.tagName === "H3" ? 3 : 2,
      })),
    );
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-scan when the path changes
  useEffect(() => {
    const nodes = document.querySelectorAll<HTMLElement>(
      ".article h2[id], .article h3[id]",
    );
    if (!nodes.length) {
      setHeadings([]);
      return;
    }
    setHeadings(
      [...nodes].map((el) => ({
        id: el.id,
        text: el.textContent ?? "",
        level: el.tagName === "H3" ? 3 : 2,
      })),
    );
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActive(entry.target.id);
          }
        }
      },
      { rootMargin: "-80px 0px -70% 0px" },
    );
    for (const node of nodes) {
      observer.observe(node);
    }
    return () => observer.disconnect();
  }, [pathname]);

  if (headings.length === 0) {
    return <aside className="toc" aria-hidden="true" />;
  }

  return (
    <aside className="toc">
      <h4>On this page</h4>
      <div id="toc-list">
        {headings.map((h) => (
          <a
            key={h.id}
            href={`#${h.id}`}
            className={`toc-link ${h.level === 3 ? "sub" : ""} ${h.id === active ? "active" : ""}`.trim()}
          >
            {h.text}
          </a>
        ))}
      </div>
    </aside>
  );
}
