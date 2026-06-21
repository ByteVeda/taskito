import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { searchDocs } from "@/lib/search";

/** ⌘K command palette: client-side search over the build-time MDX index. */
export function SearchModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const results = useMemo(() => searchDocs(query), [query]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset selection as results change
  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    if (!open) {
      setQuery("");
    }
  }, [open]);

  if (!open) {
    return null;
  }

  const go = (slug: string) => {
    onClose();
    navigate(slug);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[active]) {
      go(results[active].id);
    }
  };

  return (
    <div
      className="cmdk"
      role="dialog"
      aria-modal="true"
      aria-label="Search docs"
    >
      <button
        type="button"
        className="cmdk-backdrop"
        aria-label="Close search"
        onClick={onClose}
      />
      {/* biome-ignore lint/a11y/noStaticElementInteractions: key handling for the palette */}
      <div className="cmdk-panel" onKeyDown={onKeyDown}>
        <input
          // biome-ignore lint/a11y/noAutofocus: expected focus for a command palette
          autoFocus
          className="cmdk-input"
          type="search"
          placeholder="Search the docs…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="cmdk-results">
          {results.length === 0 && query ? (
            <div className="cmdk-empty">No results for “{query}”.</div>
          ) : (
            results.map((hit, i) => (
              <button
                key={hit.id}
                type="button"
                className={`cmdk-item ${i === active ? "active" : ""}`.trim()}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(hit.id)}
              >
                <span className="cmdk-title">{hit.title}</span>
                <span className="cmdk-section">{hit.section}</span>
              </button>
            ))
          )}
        </div>
        <div className="cmdk-foot">
          <kbd>↑↓</kbd> navigate <kbd>↵</kbd> open <kbd>esc</kbd> close
        </div>
      </div>
    </div>
  );
}
