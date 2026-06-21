import MiniSearch from "minisearch";
import { DOC_METAS } from "./manifest";

export interface SearchDoc {
  id: string; // slug
  title: string;
  section: string;
  description: string;
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
  description: d.description,
  text: `${d.description} ${humanizeSlug(d.slug)}`.trim(),
}));

let index: MiniSearch<SearchDoc> | null = null;

function getIndex(): MiniSearch<SearchDoc> {
  if (!index) {
    index = new MiniSearch<SearchDoc>({
      fields: ["title", "text", "section"],
      storeFields: ["title", "section", "description"],
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
  description: string;
}

function toHit(d: SearchDoc): SearchHit {
  return {
    id: d.id,
    title: d.title,
    section: d.section,
    description: d.description,
  };
}

// Browse-mode section order (mirrors the sidebar); unknown sections sort last.
const SECTION_ORDER = [
  "Getting Started",
  "Guides",
  "Architecture",
  "Api Reference",
  "More",
  "Node",
];
const sectionRank = (s: string) => {
  const i = SECTION_ORDER.indexOf(s);
  return i === -1 ? SECTION_ORDER.length : i;
};

/** Empty query → the full index (browse mode); otherwise ranked matches. */
export function searchDocs(query: string): SearchHit[] {
  const q = query.trim();
  if (!q) {
    return SEARCH_DOCS.map(toHit).sort(
      (a, b) => sectionRank(a.section) - sectionRank(b.section),
    );
  }
  return getIndex()
    .search(q)
    .slice(0, 20)
    .map((r) => ({
      id: r.id as string,
      title: r.title,
      section: r.section,
      description: r.description,
    }));
}
