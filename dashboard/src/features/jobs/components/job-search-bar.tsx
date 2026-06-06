import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, Search } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Input } from "@/components/ui";
import { cn } from "@/lib/cn";

interface JobSearchBarProps {
  className?: string;
}

/**
 * Jump-to-job-by-id input. Submits navigate to /jobs/$id.
 * Designed to complement the filter bar without cluttering it: paste an ID
 * and press Enter.
 */
export function JobSearchBar({ className }: JobSearchBarProps) {
  const [id, setId] = useState("");
  const navigate = useNavigate();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = id.trim();
    if (!trimmed) return;
    navigate({ to: "/jobs/$id", params: { id: trimmed } });
    setId("");
  }

  return (
    <form onSubmit={handleSubmit} className={cn("relative flex items-center", className)}>
      <Search
        className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--fg-subtle)]"
        aria-hidden
      />
      <Input
        value={id}
        onChange={(e) => setId(e.target.value)}
        placeholder="Jump to job ID…"
        aria-label="Jump to job by ID"
        className="pl-8 pr-9 font-mono text-xs"
      />
      {id ? (
        <button
          type="submit"
          aria-label="Go to job"
          className="absolute right-2 rounded p-1 text-[var(--fg-subtle)] transition-colors hover:text-[var(--fg)]"
        >
          <ArrowRight className="size-3.5" />
        </button>
      ) : null}
    </form>
  );
}
