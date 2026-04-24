import { useNavigate } from "@tanstack/react-router";
import {
  Activity,
  BarChart3,
  Box,
  CircuitBoard,
  LayoutDashboard,
  ListTree,
  type LucideIcon,
  Moon,
  ScrollText,
  Server,
  Settings2,
  Skull,
  Sun,
} from "lucide-react";
import { useCallback } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { useCommandPalette } from "@/providers/command-palette-provider";
import { type RefreshOption, useRefreshInterval } from "@/providers/refresh-interval-provider";
import { useTheme } from "@/providers/theme-provider";

interface NavCmd {
  label: string;
  to: string;
  icon: LucideIcon;
  hint?: string;
}

const NAV_COMMANDS: NavCmd[] = [
  { label: "Overview", to: "/", icon: LayoutDashboard, hint: "Home" },
  { label: "Jobs", to: "/jobs", icon: ListTree },
  { label: "Metrics", to: "/metrics", icon: BarChart3 },
  { label: "Logs", to: "/logs", icon: ScrollText },
  { label: "Queues", to: "/queues", icon: Box },
  { label: "Workers", to: "/workers", icon: Server },
  { label: "Resources", to: "/resources", icon: Activity },
  { label: "Dead letters", to: "/dead-letters", icon: Skull },
  { label: "Circuit breakers", to: "/circuit-breakers", icon: CircuitBoard },
  { label: "System", to: "/system", icon: Settings2 },
];

const REFRESH_COMMANDS: RefreshOption[] = ["2s", "5s", "10s", "off"];

export function CommandPalette() {
  const { open, setOpen } = useCommandPalette();
  const navigate = useNavigate();
  const { setTheme } = useTheme();
  const { setOption } = useRefreshInterval();

  const go = useCallback(
    (to: string) => {
      setOpen(false);
      navigate({ to });
    },
    [navigate, setOpen],
  );

  return (
    <CommandDialog open={open} onOpenChange={setOpen} label="Dashboard command palette">
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Go to">
          {NAV_COMMANDS.map(({ label, to, icon: Icon, hint }) => (
            <CommandItem key={to} value={`go ${label} ${to}`} onSelect={() => go(to)}>
              <Icon aria-hidden />
              <span>{label}</span>
              {hint ? <CommandShortcut>{hint}</CommandShortcut> : null}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Theme">
          <CommandItem
            value="theme light"
            onSelect={() => {
              setTheme("light");
              setOpen(false);
            }}
          >
            <Sun aria-hidden /> Light theme
          </CommandItem>
          <CommandItem
            value="theme dark"
            onSelect={() => {
              setTheme("dark");
              setOpen(false);
            }}
          >
            <Moon aria-hidden /> Dark theme
          </CommandItem>
          <CommandItem
            value="theme system"
            onSelect={() => {
              setTheme("system");
              setOpen(false);
            }}
          >
            <Settings2 aria-hidden /> System theme
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Refresh interval">
          {REFRESH_COMMANDS.map((option) => (
            <CommandItem
              key={option}
              value={`refresh ${option}`}
              onSelect={() => {
                setOption(option);
                setOpen(false);
              }}
            >
              <span className="ml-6">{option === "off" ? "Off" : `Every ${option}`}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
