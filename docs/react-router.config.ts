import type { Config } from "@react-router/dev/config";
import { allDocPaths } from "./app/lib/doc-paths";

// Static docs site for GitHub Pages: no server runtime, every route prerendered
// to HTML. `DOCS_BASE_PATH=/taskito` in CI deploys under docs.byteveda.org/taskito;
// unset locally so `serve build/client` works from the root.
const basename = process.env.DOCS_BASE_PATH || "/";

export default {
  ssr: false,
  basename,
  async prerender() {
    return ["/", ...allDocPaths()];
  },
} satisfies Config;
