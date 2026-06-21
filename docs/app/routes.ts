import {
  index,
  layout,
  type RouteConfig,
  route,
} from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("llms.txt", "routes/llms.txt.tsx"),
  route("llms-full.txt", "routes/llms-full.txt.tsx"),
  // Every docs URL renders inside the shell (nav + sidebar + TOC).
  layout("routes/docs-layout.tsx", [route("*", "routes/docs.$.tsx")]),
] satisfies RouteConfig;
