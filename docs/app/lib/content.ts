import type { ComponentType } from "react";
import { mountsForRelPath } from "./doc-slugs";

interface MdxModule {
  default: ComponentType;
}

// LAZY glob: each MDX compiles to its own chunk, loaded on demand by the route
// (React.lazy). Page metadata lives in the build-time manifest (manifest.ts), so
// nav/search never pull these heavy (shiki-inflated) modules into a shared chunk.
const LOADERS = import.meta.glob<MdxModule>("../../content/docs/**/*.mdx");

const BY_SLUG = new Map<string, () => Promise<MdxModule>>();
for (const [key, loader] of Object.entries(LOADERS)) {
  const rel = key.replace(/^.*\/content\/docs\//, "");
  // A shared file registers the same loader at every SDK mount (one chunk).
  for (const mount of mountsForRelPath(rel)) {
    BY_SLUG.set(mount.slug, loader);
  }
}

/** The dynamic import for a doc page's compiled component, or undefined if unknown. */
export function getDocLoader(
  path: string,
): (() => Promise<MdxModule>) | undefined {
  return BY_SLUG.get(path.replace(/\/$/, "") || "/");
}

export function allDocSlugs(): string[] {
  return [...BY_SLUG.keys()];
}
