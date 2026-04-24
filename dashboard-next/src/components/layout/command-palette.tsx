import { useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/cn";
import { useCommandPalette } from "@/providers/command-palette-provider";

interface CommandItem {
  id: string;
  label: string;
  hint?: string;
  to: string;
  keywords?: string;
}

const COMMANDS: CommandItem[] = [
  { id: "nav.overview", label: "Go to Overview", to: "/", hint: "Home" },
  { id: "nav.jobs", label: "Go to Jobs", to: "/jobs", keywords: "tasks list" },
  { id: "nav.metrics", label: "Go to Metrics", to: "/metrics", keywords: "graphs charts" },
  { id: "nav.logs", label: "Go to Logs", to: "/logs" },
  { id: "nav.queues", label: "Go to Queues", to: "/queues", keywords: "pause resume" },
  { id: "nav.workers", label: "Go to Workers", to: "/workers" },
  { id: "nav.resources", label: "Go to Resources", to: "/resources" },
  {
    id: "nav.dead-letters",
    label: "Go to Dead letters",
    to: "/dead-letters",
    keywords: "dlq retry",
  },
  {
    id: "nav.circuit-breakers",
    label: "Go to Circuit breakers",
    to: "/circuit-breakers",
    keywords: "fault tolerance",
  },
  { id: "nav.system", label: "Go to System", to: "/system", keywords: "proxy interception" },
];

export function CommandPalette() {
  const { open, setOpen } = useCommandPalette();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      queueMicrotask(() => inputRef.current?.focus());
    }
  }, [open]);

  const normalized = query.trim().toLowerCase();
  const results = normalized
    ? COMMANDS.filter((c) => `${c.label} ${c.keywords ?? ""}`.toLowerCase().includes(normalized))
    : COMMANDS;

  const runAt = useCallback(
    (index: number) => {
      const item = results[index];
      if (!item) return;
      setOpen(false);
      navigate({ to: item.to });
    },
    [navigate, results, setOpen],
  );

  useEffect(() => {
    if (activeIndex >= results.length) setActiveIndex(Math.max(0, results.length - 1));
  }, [activeIndex, results.length]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[15vh] animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div className="absolute inset-0 bg-black/40" aria-hidden onClick={() => setOpen(false)} />
      <div
        className="relative w-full max-w-xl rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] shadow-2xl animate-slide-up"
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((i) => Math.min(i + 1, results.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((i) => Math.max(i - 1, 0));
          } else if (event.key === "Enter") {
            event.preventDefault();
            runAt(activeIndex);
          }
        }}
      >
        <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3">
          <Search className="size-4 text-[var(--fg-subtle)]" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command or search…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--fg-subtle)]"
            aria-label="Search"
          />
          <Kbd>Esc</Kbd>
        </div>
        <ul className="max-h-[320px] overflow-y-auto p-2">
          {results.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-[var(--fg-subtle)]">No matches</li>
          ) : (
            results.map((item, i) => (
              <li key={item.id}>
                <button
                  type="button"
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => runAt(i)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors",
                    i === activeIndex
                      ? "bg-[var(--surface-2)] text-[var(--fg)]"
                      : "text-[var(--fg-muted)] hover:bg-[var(--surface-2)]",
                  )}
                >
                  <span>{item.label}</span>
                  {item.hint ? (
                    <span className="text-xs text-[var(--fg-subtle)]">{item.hint}</span>
                  ) : null}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
