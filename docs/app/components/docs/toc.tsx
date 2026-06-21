import { useEffect, useState } from "react";
import { useLocation } from "react-router";

interface Heading {
  id: string;
  text: string;
  level: number;
}

function readHeadings(article: Element): Heading[] {
  return [...article.querySelectorAll<HTMLElement>("h2[id], h3[id]")].map(
    (el) => ({
      id: el.id,
      text: el.textContent ?? "",
      level: el.tagName === "H3" ? 3 : 2,
    }),
  );
}

/** On-this-page TOC, built from the rendered article headings with scroll-spy. */
export function Toc() {
  const { pathname } = useLocation();
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [active, setActive] = useState<string>("");

  // The article is a lazily-loaded MDX chunk, so its headings are NOT in the DOM
  // when this effect first runs after a client-side navigation. Re-scan on every
  // article mutation (via MutationObserver) so the TOC fills in once the page
  // content actually mounts, and re-arm scroll-spy whenever the heading set changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-scan when the path changes
  useEffect(() => {
    const article = document.querySelector(".article");
    if (!article) {
      setHeadings([]);
      return;
    }
    let spy: IntersectionObserver | null = null;
    let lastKey = "";

    const scan = () => {
      const next = readHeadings(article);
      const key = next.map((h) => h.id).join("|");
      if (key === lastKey) {
        return;
      }
      lastKey = key;
      setHeadings(next);
      spy?.disconnect();
      if (!next.length) {
        return;
      }
      spy = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              setActive(entry.target.id);
            }
          }
        },
        { rootMargin: "-80px 0px -70% 0px" },
      );
      for (const el of article.querySelectorAll("h2[id], h3[id]")) {
        spy.observe(el);
      }
    };

    scan();
    const content = new MutationObserver(scan);
    content.observe(article, { childList: true, subtree: true });
    return () => {
      content.disconnect();
      spy?.disconnect();
    };
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
