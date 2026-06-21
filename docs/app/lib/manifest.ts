// Lightweight page metadata (slug/title/description) from the build-time manifest
// (vite-plugin-docs-manifest). No compiled MDX here — keeps nav/search/llms out of
// the heavy component graph.
import { DOCS } from "virtual:docs-manifest";

export interface DocMeta {
  slug: string;
  title: string;
  description: string;
}

export const DOC_METAS: DocMeta[] = DOCS;

const BY_SLUG = new Map(DOC_METAS.map((d) => [d.slug, d]));

export function docMeta(slug: string): DocMeta | undefined {
  return BY_SLUG.get(slug.replace(/\/$/, "") || "/");
}

export function docTitle(slug: string): string | undefined {
  return BY_SLUG.get(slug)?.title;
}

export function hasDoc(slug: string): boolean {
  return BY_SLUG.has(slug);
}
