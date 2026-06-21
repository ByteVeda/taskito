import type { ComponentType } from "react";

interface MdxModule {
  default: ComponentType;
}

// LAZY glob: each MDX compiles to its own chunk, loaded on demand by the route
// (React.lazy). Page metadata lives in the build-time manifest (manifest.ts), so
// nav/search never pull these heavy (shiki-inflated) modules into a shared chunk.
const LOADERS = import.meta.glob<MdxModule>("../../content/docs/**/*.mdx");

function keyToSlug(key: string): string {
  const rel = key.replace(/^.*\/content\/docs\//, "").replace(/\.mdx$/, "");
  const parts = rel.split("/");
  if (parts[parts.length - 1] === "index") {
    parts.pop();
  }
  return `/${parts.join("/")}`.replace(/\/$/, "") || "/";
}

const BY_SLUG = new Map<string, () => Promise<MdxModule>>();
for (const [key, loader] of Object.entries(LOADERS)) {
  BY_SLUG.set(keyToSlug(key), loader);
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
