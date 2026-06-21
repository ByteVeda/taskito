import { index, type RouteConfig } from "@react-router/dev/routes";

// Phase 1: landing only. The docs catch-all + LLM-text routes arrive with the
// MDX pipeline (Phase 3).
export default [index("routes/home.tsx")] satisfies RouteConfig;
