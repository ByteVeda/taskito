import { type ComponentType, type LazyExoticComponent, lazy } from "react";
import type { DemoId, DemoProps } from "./types";

type LazyDemo = LazyExoticComponent<ComponentType<DemoProps>>;

/**
 * React ports of the interactive demos, keyed by demo id and lazy-loaded so the
 * homepage bundle stays small. {@link DemoModal} renders the matching component
 * inside its stage; the type stays partial so an unknown id degrades gracefully.
 */
export const DEMO_COMPONENTS: Record<DemoId, LazyDemo> = {
  mesh: lazy(() => import("./mesh-demo")),
  ratelimit: lazy(() => import("./ratelimit-demo")),
  recovery: lazy(() => import("./recovery-demo")),
  scaling: lazy(() => import("./scaling-demo")),
  saga: lazy(() => import("./saga-demo")),
  workflow: lazy(() => import("./workflow-demo")),
  worksteal: lazy(() => import("./worksteal-demo")),
};

/** The React port for `id`, or `undefined` for an unknown demo id. */
export function demoComponent(id: string): LazyDemo | undefined {
  return DEMO_COMPONENTS[id as DemoId];
}
