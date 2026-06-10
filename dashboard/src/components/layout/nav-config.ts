import {
  Activity,
  BarChart3,
  Box,
  CircuitBoard,
  Cog,
  GitBranch,
  LayoutDashboard,
  ListTree,
  type LucideIcon,
  ScrollText,
  Server,
  Settings2,
  Skull,
  Webhook as WebhookIcon,
} from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

/**
 * Single source of truth for the primary navigation. Consumed by both the
 * desktop {@link Sidebar} and the {@link MobileMenu} so the two never drift.
 */
export const NAV: NavGroup[] = [
  {
    title: "Monitoring",
    items: [
      { to: "/", label: "Overview", icon: LayoutDashboard },
      { to: "/jobs", label: "Jobs", icon: ListTree },
      { to: "/metrics", label: "Metrics", icon: BarChart3 },
      { to: "/logs", label: "Logs", icon: ScrollText },
      { to: "/workflows", label: "Workflows", icon: GitBranch },
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
    items: [
      { to: "/tasks", label: "Tasks", icon: ListTree },
      { to: "/webhooks", label: "Webhooks", icon: WebhookIcon },
      { to: "/settings", label: "Settings", icon: Cog },
    ],
  },
];
