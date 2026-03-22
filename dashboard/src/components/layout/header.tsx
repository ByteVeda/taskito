import { Moon, RefreshCw, Search, Sun, Zap } from "lucide-preact";
import { useEffect, useState } from "preact/hooks";
import { route } from "preact-router";
import {
  lastRefreshAt,
  refreshInterval,
  setRefreshInterval,
  theme,
  toggleTheme,
} from "../../hooks";

function RelativeTime() {
  const [ago, setAgo] = useState("");

  useEffect(() => {
    const update = () => {
      const seconds = Math.round((Date.now() - lastRefreshAt.value) / 1000);
      setAgo(seconds < 2 ? "just now" : `${seconds}s ago`);
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [lastRefreshAt.value]);

  return <span class="text-[11px] text-muted tabular-nums">{ago}</span>;
}

export function Header() {
  const [searchValue, setSearchValue] = useState("");

  const handleSearch = (e: Event) => {
    e.preventDefault();
    const id = searchValue.trim();
    if (id) {
      route(`/jobs/${id}`);
      setSearchValue("");
    }
  };

  return (
    <header class="h-14 flex items-center justify-between px-6 dark:bg-surface-2/80 bg-white/80 backdrop-blur-md border-b dark:border-white/[0.06] border-slate-200 sticky top-0 z-40">
      <a href="/" class="flex items-center gap-2 no-underline group">
        <div class="w-7 h-7 rounded-lg bg-gradient-to-br from-accent to-accent-light flex items-center justify-center shadow-md shadow-accent/20">
          <Zap class="w-4 h-4 text-white" strokeWidth={2.5} />
        </div>
        <span class="text-[15px] font-semibold dark:text-white text-slate-900 tracking-tight">
          taskito
        </span>
        <span class="text-xs text-muted font-normal hidden sm:inline">dashboard</span>
      </a>

      {/* Job ID search */}
      <form
        onSubmit={handleSearch}
        class="flex items-center gap-2 dark:bg-surface-3 bg-slate-100 rounded-lg px-3 py-1.5 border dark:border-white/[0.06] border-slate-200 w-64"
      >
        <Search class="w-3.5 h-3.5 text-muted shrink-0" />
        <input
          type="text"
          placeholder="Jump to job ID\u2026"
          value={searchValue}
          onInput={(e) => setSearchValue((e.target as HTMLInputElement).value)}
          class="bg-transparent border-none outline-none text-[13px] dark:text-gray-200 text-slate-700 placeholder:text-muted/50 w-full"
        />
      </form>

      <div class="flex items-center gap-3">
        {/* Refresh interval + indicator */}
        <div class="flex items-center gap-2 text-xs">
          <RefreshCw
            class={`w-3.5 h-3.5 ${refreshInterval.value > 0 ? "text-accent" : "text-muted"}`}
            strokeWidth={refreshInterval.value > 0 ? 2 : 1.5}
          />
          <select
            class="dark:bg-surface-3 bg-slate-100 dark:text-gray-300 text-slate-600 border dark:border-white/[0.06] border-slate-200 rounded-md px-2 py-1 text-xs cursor-pointer hover:dark:border-white/10 hover:border-slate-300 transition-colors"
            value={refreshInterval.value}
            onChange={(e) => setRefreshInterval(Number((e.target as HTMLSelectElement).value))}
          >
            <option value={2000}>2s</option>
            <option value={5000}>5s</option>
            <option value={10000}>10s</option>
            <option value={0}>Off</option>
          </select>
          <RelativeTime />
        </div>

        <div class="w-px h-5 dark:bg-white/[0.06] bg-slate-200" />

        {/* Theme toggle */}
        <button
          type="button"
          onClick={toggleTheme}
          class="p-2 rounded-lg dark:text-gray-400 text-slate-500 hover:dark:text-white hover:text-slate-900 hover:dark:bg-surface-3 hover:bg-slate-100 transition-all duration-150 border-none cursor-pointer bg-transparent"
          title={`Switch to ${theme.value === "dark" ? "light" : "dark"} mode`}
        >
          {theme.value === "dark" ? <Sun class="w-4 h-4" /> : <Moon class="w-4 h-4" />}
        </button>
      </div>
    </header>
  );
}
