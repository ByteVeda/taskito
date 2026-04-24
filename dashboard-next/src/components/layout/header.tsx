import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { useCommandPalette } from "@/providers/command-palette-provider";
import { RefreshControl } from "./refresh-control";
import { ThemeToggle } from "./theme-toggle";

export function Header() {
  const { setOpen } = useCommandPalette();
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-[var(--border)] bg-[var(--bg)]/85 px-5 backdrop-blur supports-[backdrop-filter]:bg-[var(--bg)]/70">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="w-[260px] justify-between text-[var(--fg-subtle)] font-normal"
      >
        <span className="inline-flex items-center gap-2">
          <Search className="size-3.5" aria-hidden />
          Search jobs, queues…
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </span>
      </Button>
      <div className="ml-auto flex items-center gap-3">
        <RefreshControl />
        <ThemeToggle />
      </div>
    </header>
  );
}
