import { type ComponentType, type LazyExoticComponent, lazy } from "react";
import type { DemoId, DemoProps } from "./types";

type LazyDemo = LazyExoticComponent<ComponentType<DemoProps>>;

/**
 * React ports of the interactive demos, keyed by demo id and lazy-loaded so the
 * homepage bundle stays small. Ids absent here fall back to the vendored
 * `interactive.html` iframe in {@link DemoModal} until ported — see
 * `tasks/react-demos-plan.md`. Once every id is present, the iframe path and
 * `public/demos/` are removed.
 */
export const DEMO_COMPONENTS: Partial<Record<DemoId, LazyDemo>> = {
  mesh: lazy(() => import("./mesh-demo")),
  ratelimit: lazy(() => import("./ratelimit-demo")),
  recovery: lazy(() => import("./recovery-demo")),
  scaling: lazy(() => import("./scaling-demo")),
  saga: lazy(() => import("./saga-demo")),
  workflow: lazy(() => import("./workflow-demo")),
  worksteal: lazy(() => import("./worksteal-demo")),
};

/** The React port for `id`, or `undefined` if it still uses the iframe. */
export function demoComponent(id: string): LazyDemo | undefined {
  return DEMO_COMPONENTS[id as DemoId];
}
