/** The interactive demos the homepage scenario finder can open. */
export type DemoId =
  | "ratelimit"
  | "recovery"
  | "scaling"
  | "progress"
  | "workflow"
  | "mesh"
  | "saga"
  | "worksteal";

/** Props every demo component receives from {@link DemoModal}. */
export interface DemoProps {
  /** Active host theme, so a demo can pick palette variants if it needs to. */
  theme: "light" | "dark";
}
