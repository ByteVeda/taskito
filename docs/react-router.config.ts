import type { Config } from "@react-router/dev/config";
import { allDocPaths } from "./app/lib/doc-paths";
import { redirectPaths } from "./app/lib/redirects";

// Static docs site for GitHub Pages: no server runtime, every route prerendered
// to HTML. `DOCS_BASE_PATH=/taskito` in CI deploys under docs.byteveda.org/taskito;
// unset locally so `serve build/client` works from the root.
const basename = process.env.DOCS_BASE_PATH || "/";

export default {
  ssr: false,
  basename,
  // Opt into the React Router v8 behaviors now (silences the dev future-flag
  // warnings and future-proofs the migration). All are compatible with this
  // static, prerendered, loader-light site.
  future: {
    v8_middleware: true,
    v8_splitRouteModules: true,
    v8_viteEnvironmentApi: true,
    v8_passThroughRequests: true,
    v8_trailingSlashAwareDataRequests: true,
  },
  async prerender() {
    return [
      "/",
      "/llms.txt",
      "/llms-full.txt",
      ...allDocPaths(),
      ...redirectPaths(),
    ];
  },
} satisfies Config;
