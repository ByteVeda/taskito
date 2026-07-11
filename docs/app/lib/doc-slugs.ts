// Explicit .ts extension: this module is also imported by the parity script
// under plain Node (type stripping), where extensionless specifiers don't resolve.
import { DEFAULT_SDK, SDK_IDS } from "./sdk-registry.ts";

// The single source of slug derivation and shared-content fan-out. The runtime
// loader (content.ts), the prerender walk (doc-paths.ts), the manifest plugin
// (vite-plugin-docs-manifest.ts), and the parity script all resolve content
// files through here, so the served, prerendered, and indexed URL sets can't
// drift apart. Isomorphic on purpose: operates on posix content-relative paths,
// no node imports.

/** Directory under `content/docs` whose files mount once per SDK. */
export const SHARED_DIR = "shared";

/** One URL a content file is served at. `canonical` is set on fan-out mounts
 *  and points at the default-SDK mount (self-referential there). */
export interface DocMount {
  slug: string;
  canonical?: string;
}

/** `a/b.mdx` → `/a/b`; `a/b/index.mdx` → `/a/b`. Posix content-relative path. */
export function relPathToSlug(rel: string): string {
  const parts = rel.replace(/\.mdx$/, "").split("/");
  if (parts[parts.length - 1] === "index") {
    parts.pop();
  }
  return `/${parts.join("/")}`.replace(/\/$/, "") || "/";
}

/** True when the file lives under the shared (fan-out) tree. */
export function isSharedRelPath(rel: string): boolean {
  return rel === SHARED_DIR || rel.startsWith(`${SHARED_DIR}/`);
}

/** Every URL a content file mounts at. A shared file fans out to one mount per
 *  SDK (`shared/x.mdx` → `/{sdk}/x`); anything else keeps its single 1:1 slug. */
export function mountsForRelPath(rel: string): DocMount[] {
  const slug = relPathToSlug(rel);
  if (!isSharedRelPath(rel)) {
    return [{ slug }];
  }
  const topic = slug.slice(`/${SHARED_DIR}`.length); // "/guides/x" or ""
  const canonical = `/${DEFAULT_SDK}${topic}`;
  return SDK_IDS.map((sdk) => ({ slug: `/${sdk}${topic}`, canonical }));
}
