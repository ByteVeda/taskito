import { Link, useLocation } from "@tanstack/react-router";
import {
  Activity,
  AlertOctagon,
  BarChart3,
  Box,
  CircuitBoard,
  LayoutDashboard,
  ListTree,
  type LucideIcon,
  ScrollText,
  Server,
  Settings2,
  Skull,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { site } from "@/lib/site";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    title: "Monitoring",
    items: [
      { to: "/", label: "Overview", icon: LayoutDashboard },
      { to: "/jobs", label: "Jobs", icon: ListTree },
      { to: "/metrics", label: "Metrics", icon: BarChart3 },
      { to: "/logs", label: "Logs", icon: ScrollText },
    ],
  },
  {
    title: "Infrastructure",
    items: [
      { to: "/queues", label: "Queues", icon: Box },
      { to: "/workers", label: "Workers", icon: Server },
      { to: "/resources", label: "Resources", icon: Activity },
    ],
  },
  {
    title: "Reliability",
    items: [
      { to: "/dead-letters", label: "Dead letters", icon: Skull },
      { to: "/circuit-breakers", label: "Circuit breakers", icon: CircuitBoard },
      { to: "/system", label: "System", icon: Settings2 },
    ],
  },
];

export function Sidebar() {
  const { pathname } = useLocation();
  return (
    <aside className="hidden lg:flex w-60 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-subtle)]">
      <div className="flex items-center gap-2 px-5 py-4">
        <div className="grid place-items-center size-7 rounded-md bg-accent text-accent-fg">
          <AlertOctagon className="size-4" aria-hidden />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold tracking-tight">{site.name}</span>
          <span className="text-[10px] uppercase tracking-wider text-[var(--fg-subtle)]">
            Dashboard
          </span>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        {NAV.map((group) => (
          <div key={group.title} className="mt-5 first:mt-2">
            <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-subtle)]">
              {group.title}
            </div>
            <ul className="flex flex-col gap-0.5">
              {group.items.map(({ to, label, icon: Icon }) => {
                const active = pathname === to || (to !== "/" && pathname.startsWith(`${to}/`));
                return (
                  <li key={to}>
                    <Link
                      to={to}
                      className={cn(
                        "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
                        active
                          ? "bg-[var(--surface-2)] text-[var(--fg)] shadow-xs"
                          : "text-[var(--fg-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]",
                      )}
                    >
                      <Icon className={cn("size-4", active && "text-accent")} aria-hidden />
                      <span>{label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-[var(--border)] px-5 py-3 text-[11px] text-[var(--fg-subtle)]">
        {import.meta.env.DEV ? "dev build" : "production"}
      </div>
    </aside>
  );
}
