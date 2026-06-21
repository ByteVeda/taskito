import type { ComponentType } from "react";

export interface DocFrontmatter {
  title?: string;
  description?: string;
}

interface MdxModule {
  default: ComponentType;
  frontmatter?: DocFrontmatter;
}

// Compile every content MDX into the bundle (the doc source — reused unchanged).
// Eager so page lookup + prerender are synchronous; vite still splits assets.
const MODULES = import.meta.glob<MdxModule>("../../content/docs/**/*.mdx", {
  eager: true,
});

/** `…/content/docs/getting-started/installation.mdx` → `/getting-started/installation`;
 *  `…/node/index.mdx` → `/node`. Mirrors app/lib/doc-paths.ts (build-time prerender list). */
function keyToSlug(key: string): string {
  const rel = key.replace(/^.*\/content\/docs\//, "").replace(/\.mdx$/, "");
  const parts = rel.split("/");
  if (parts[parts.length - 1] === "index") {
    parts.pop();
  }
  return `/${parts.join("/")}`.replace(/\/$/, "") || "/";
}

export interface DocPage {
  slug: string;
  Component: ComponentType;
  frontmatter: DocFrontmatter;
}

const PAGES = new Map<string, DocPage>();
for (const [key, mod] of Object.entries(MODULES)) {
  const slug = keyToSlug(key);
  PAGES.set(slug, {
    slug,
    Component: mod.default,
    frontmatter: mod.frontmatter ?? {},
  });
}

/** Resolve a URL path (e.g. `/node/workflows/saga`) to its rendered MDX page. */
export function getDocPage(path: string): DocPage | undefined {
  return PAGES.get(path.replace(/\/$/, "") || "/");
}

export function allDocSlugs(): string[] {
  return [...PAGES.keys()];
}
