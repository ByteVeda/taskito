import { getDocPage } from "./content";

interface Meta {
  title?: string;
  pages?: string[];
  root?: boolean;
}

// meta.json files describe nav order + group titles; reused unchanged as the nav
// source (same files Fumadocs used), keyed by their content-relative directory.
const META = import.meta.glob<{ default: Meta }>(
  "../../content/docs/**/meta.json",
  {
    eager: true,
  },
);

function metaFor(dir: string): Meta {
  const suffix = dir ? `${dir}/meta.json` : "meta.json";
  for (const [key, mod] of Object.entries(META)) {
    if (key.endsWith(`/content/docs/${suffix}`)) {
      return mod.default;
    }
  }
  return {};
}

function humanize(name: string): string {
  return name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function titleFor(slug: string, fallback: string): string {
  return (
    getDocPage(slug)?.frontmatter.title ??
    metaFor(slug.replace(/^\//, "")).title ??
    humanize(fallback)
  );
}

/** A sidebar entry: either a link (`href`) or a labelled group (`children`). */
export interface NavNode {
  title: string;
  href?: string;
  children?: NavNode[];
}

/** Build the nav nodes for a directory's `pages`, recursing into subsections. */
function nodesForDir(dir: string): NavNode[] {
  const meta = metaFor(dir);
  const nodes: NavNode[] = [];
  for (const name of meta.pages ?? []) {
    if (name === "index") {
      continue; // the section's own index is its group header, not a child item
    }
    const childDir = `${dir}/${name}`;
    const childMeta = metaFor(childDir);
    if (childMeta.pages) {
      // Subsection → nested group. Link the group title to its index page if any.
      const indexSlug = `/${childDir}`;
      nodes.push({
        title: childMeta.title ?? humanize(name),
        href: getDocPage(indexSlug) ? indexSlug : undefined,
        children: nodesForDir(childDir),
      });
    } else {
      const slug = `/${childDir}`;
      nodes.push({ title: titleFor(slug, name), href: slug });
    }
  }
  return nodes;
}

/** Top-level sidebar groups for an SDK, one per section directory. */
function buildTree(sections: string[]): NavNode[] {
  return sections.map((dir) => {
    const indexSlug = `/${dir}`;
    return {
      title: metaFor(dir).title ?? humanize(dir),
      href: getDocPage(indexSlug) ? indexSlug : undefined,
      children: nodesForDir(dir),
    };
  });
}

export const PYTHON_SECTIONS = [
  "getting-started",
  "guides",
  "architecture",
  "api-reference",
  "more",
];
export const NODE_SECTIONS = ["node"];

export const PYTHON_NAV = buildTree(PYTHON_SECTIONS);
export const NODE_NAV = buildTree(NODE_SECTIONS);

export type Sdk = "python" | "node";

export function sdkForPath(path: string): Sdk {
  return path === "/node" || path.startsWith("/node/") ? "node" : "python";
}

export function navForSdk(sdk: Sdk): NavNode[] {
  return sdk === "node" ? NODE_NAV : PYTHON_NAV;
}

/** Depth-first flattened links for the active SDK — drives prev/next. */
export function flatNav(sdk: Sdk): { title: string; href: string }[] {
  const out: { title: string; href: string }[] = [];
  const walk = (nodes: NavNode[]) => {
    for (const n of nodes) {
      if (n.href) {
        out.push({ title: n.title, href: n.href });
      }
      if (n.children) {
        walk(n.children);
      }
    }
  };
  walk(navForSdk(sdk));
  return out;
}
