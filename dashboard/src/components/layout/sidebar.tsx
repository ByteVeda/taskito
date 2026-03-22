import type { LucideIcon } from "lucide-preact";
import {
  BarChart3,
  Box,
  Cog,
  Layers,
  LayoutDashboard,
  ListTodo,
  ScrollText,
  Server,
  ShieldAlert,
  Skull,
} from "lucide-preact";
import { useEffect, useState } from "preact/hooks";
import { getCurrentUrl } from "preact-router";

interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: "Monitoring",
    items: [
      { path: "/", label: "Overview", icon: LayoutDashboard },
      { path: "/jobs", label: "Jobs", icon: ListTodo },
      { path: "/metrics", label: "Metrics", icon: BarChart3 },
      { path: "/logs", label: "Logs", icon: ScrollText },
    ],
  },
  {
    title: "Infrastructure",
    items: [
      { path: "/workers", label: "Workers", icon: Server },
      { path: "/queues", label: "Queues", icon: Layers },
      { path: "/resources", label: "Resources", icon: Box },
      { path: "/circuit-breakers", label: "Circuit Breakers", icon: ShieldAlert },
    ],
  },
  {
    title: "Advanced",
    items: [
      { path: "/dead-letters", label: "Dead Letters", icon: Skull },
      { path: "/system", label: "System", icon: Cog },
    ],
  },
];

function isActive(current: string, path: string): boolean {
  if (path === "/") return current === "/";
  return current === path || current.startsWith(`${path}/`);
}

export function Sidebar() {
  const [currentPath, setCurrentPath] = useState(getCurrentUrl());

  useEffect(() => {
    const handler = () => setCurrentPath(getCurrentUrl());
    addEventListener("popstate", handler);
    addEventListener("pushstate", handler);
    return () => {
      removeEventListener("popstate", handler);
      removeEventListener("pushstate", handler);
    };
  }, []);

  return (
    <aside class="w-60 shrink-0 border-r dark:border-white/[0.06] border-slate-200 dark:bg-surface-2 bg-white overflow-y-auto h-[calc(100vh-56px)]">
      <nav class="p-3 space-y-5 pt-4">
        {NAV_GROUPS.map((group) => (
          <div key={group.title}>
            <div class="px-3 pb-2 text-[10px] font-bold uppercase tracking-[0.1em] text-muted/60">
              {group.title}
            </div>
            <div class="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(currentPath, item.path);
                const Icon = item.icon;
                return (
                  <a
                    key={item.path}
                    href={item.path}
                    class={`flex items-center gap-2.5 px-3 py-2 text-[13px] rounded-lg transition-all duration-150 no-underline relative ${
                      active
                        ? "dark:bg-accent/10 bg-accent/5 dark:text-white text-slate-900 font-medium"
                        : "dark:text-gray-400 text-slate-500 hover:dark:text-gray-200 hover:text-slate-700 hover:dark:bg-white/[0.03] hover:bg-slate-100"
                    }`}
                  >
                    {active && (
                      <div class="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-r-full bg-accent" />
                    )}
                    <Icon
                      class={`w-4 h-4 shrink-0 ${active ? "text-accent" : ""}`}
                      strokeWidth={active ? 2.2 : 1.8}
                    />
                    {item.label}
                  </a>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
