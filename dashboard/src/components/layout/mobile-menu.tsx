import { Link, useLocation } from "@tanstack/react-router";
import {
  Activity,
  BarChart3,
  Box,
  CircuitBoard,
  Cog,
  ExternalLink as ExternalLinkIcon,
  LayoutDashboard,
  ListTree,
  type LucideIcon,
  Menu,
  ScrollText,
  Server,
  Settings2,
  Skull,
} from "lucide-react";
import { useState } from "react";
import {
  Button,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui";
import { useBranding, useExternalLinks } from "@/features/settings";
import { cn } from "@/lib/cn";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

const NAV: Array<{ title: string; items: NavItem[] }> = [
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
  {
    title: "Configuration",
    items: [{ to: "/settings", label: "Settings", icon: Cog }],
  },
];

export function MobileMenu() {
  const { pathname } = useLocation();
  const { title } = useBranding();
  const externalLinks = useExternalLinks();
  const [open, setOpen] = useState(false);

  const close = () => setOpen(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation">
          <Menu className="size-4" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="flex flex-col p-0">
        <SheetHeader className="border-b border-[var(--border)] px-5 py-4">
          <SheetTitle>{title} Dashboard</SheetTitle>
        </SheetHeader>
        <nav className="flex-1 overflow-y-auto px-3 py-3">
          {NAV.map((group) => (
            <div key={group.title} className="mt-4 first:mt-1">
              <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-subtle)]">
                {group.title}
              </div>
              <ul className="flex flex-col gap-0.5">
                {group.items.map(({ to, label, icon: Icon }) => {
                  const active = pathname === to || (to !== "/" && pathname.startsWith(`${to}/`));
                  return (
                    <li key={to}>
                      <Link
                        to={to}
                        onClick={close}
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
          {externalLinks.length > 0 ? (
            <div className="mt-4">
              <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-subtle)]">
                Links
              </div>
              <ul className="flex flex-col gap-0.5">
                {externalLinks.map((link) => (
                  <li key={`${link.label}|${link.url}`}>
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      onClick={close}
                      className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-[var(--fg-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--fg)]"
                    >
                      <ExternalLinkIcon className="size-4" aria-hidden />
                      <span className="truncate">{link.label}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
