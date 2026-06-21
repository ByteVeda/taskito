import { index, type RouteConfig, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  // Catch-all renders the MDX doc page for the URL slug.
  route("*", "routes/docs.$.tsx"),
] satisfies RouteConfig;
