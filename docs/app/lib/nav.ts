import { docTitle, hasDoc } from "./manifest";
import type { Sdk } from "./sdk-store";

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
    docTitle(slug) ??
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
        href: hasDoc(indexSlug) ? indexSlug : undefined,
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
      href: hasDoc(indexSlug) ? indexSlug : undefined,
      children: nodesForDir(dir),
    };
  });
}

// `architecture` and `resources` are SDK-neutral (the engine is identical across
// SDKs); both live at top-level shared URLs and appear in every SDK's nav.
export const PYTHON_SECTIONS = [
  "python/getting-started",
  "python/guides",
  "architecture",
  "python/api-reference",
  "python/more/examples",
  "resources",
];
export const NODE_SECTIONS = [
  "node/getting-started",
  "node/guides",
  "architecture",
  "node/api-reference",
  "resources",
];

export const PYTHON_NAV = buildTree(PYTHON_SECTIONS);
export const NODE_NAV = buildTree(NODE_SECTIONS);

export type { Sdk };

/** The SDK forced by an explicit `/python`|`/node` URL prefix, or null on a
 *  shared page (where the active SDK comes from the global store instead). */
export function forcedSdkForPath(path: string): Sdk | null {
  if (path === "/node" || path.startsWith("/node/")) {
    return "node";
  }
  if (path === "/python" || path.startsWith("/python/")) {
    return "python";
  }
  return null;
}

/** Where the sidebar SDK switch should go: the same page under the target SDK's
 *  prefix if it exists, else that SDK's install landing. Shared pages stay put
 *  (the caller skips navigation when the current path isn't SDK-prefixed). */
export function sdkSwitchTarget(path: string, target: Sdk): string {
  const other: Sdk = target === "node" ? "python" : "node";
  const prefix = `/${other}`;
  if (path === prefix || path.startsWith(`${prefix}/`)) {
    const swapped = `/${target}${path.slice(prefix.length)}`;
    if (hasDoc(swapped)) {
      return swapped;
    }
  }
  return `/${target}/getting-started/installation`;
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
