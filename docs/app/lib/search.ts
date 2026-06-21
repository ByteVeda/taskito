import MiniSearch from "minisearch";
import { DOC_METAS } from "./manifest";

export interface SearchDoc {
  id: string; // slug
  title: string;
  section: string;
  text: string;
}

function sectionOf(slug: string): string {
  const top = slug.split("/")[1] ?? "";
  return top
    ? top.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    : "Home";
}

function humanizeSlug(slug: string): string {
  return slug.split("/").filter(Boolean).join(" ").replace(/-/g, " ");
}

// Index built from the build-time manifest (title + description + slug words).
// No compiled MDX pulled in — keeps the search chunk tiny.
export const SEARCH_DOCS: SearchDoc[] = DOC_METAS.map((d) => ({
  id: d.slug,
  title: d.title,
  section: sectionOf(d.slug),
  text: `${d.description} ${humanizeSlug(d.slug)}`.trim(),
}));

let index: MiniSearch<SearchDoc> | null = null;

function getIndex(): MiniSearch<SearchDoc> {
  if (!index) {
    index = new MiniSearch<SearchDoc>({
      fields: ["title", "text", "section"],
      storeFields: ["title", "section"],
      searchOptions: {
        boost: { title: 3, section: 1.5 },
        prefix: true,
        fuzzy: 0.2,
      },
    });
    index.addAll(SEARCH_DOCS);
  }
  return index;
}

export interface SearchHit {
  id: string;
  title: string;
  section: string;
}

export function searchDocs(query: string): SearchHit[] {
  const q = query.trim();
  if (!q) {
    return [];
  }
  return getIndex()
    .search(q)
    .slice(0, 12)
    .map((r) => ({ id: r.id as string, title: r.title, section: r.section }));
}
