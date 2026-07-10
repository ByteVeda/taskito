import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { mountsForRelPath } from "./app/lib/doc-slugs.ts";

// Build-time manifest of doc pages: { slug, title, description, canonical? } only —
// NO compiled components. nav/search/llms import this (via `virtual:docs-manifest`)
// instead of the component glob, so they never pull the shiki-inflated MDX modules
// into a chunk. Shared files emit one entry per SDK mount (same frontmatter).

const CONTENT_DIR = fileURLToPath(new URL("./content/docs", import.meta.url));
const VIRTUAL_ID = "virtual:docs-manifest";
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

export interface DocMeta {
  slug: string;
  title: string;
  description: string;
  /** Default-SDK URL of a shared page; present only on fan-out mounts. */
  canonical?: string;
}

function parseFrontmatter(raw: string): { title: string; description: string } {
  const fm = raw.match(/^---\n([\s\S]*?)\n---/);
  const block = fm?.[1] ?? "";
  const field = (name: string) =>
    block.match(new RegExp(`^${name}:\\s*"?(.+?)"?\\s*$`, "m"))?.[1] ?? "";
  return { title: field("title"), description: field("description") };
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.name.endsWith(".mdx")) {
      out.push(full);
    }
  }
}

function buildManifest(): DocMeta[] {
  const files: string[] = [];
  walk(CONTENT_DIR, files);
  const sources = new Map<string, string>(); // slug → content-relative source file
  const metas: DocMeta[] = [];
  for (const file of files) {
    const { title, description } = parseFrontmatter(readFileSync(file, "utf8"));
    const rel = relative(CONTENT_DIR, file).split(sep).join("/");
    for (const { slug, canonical } of mountsForRelPath(rel)) {
      const existing = sources.get(slug);
      if (existing) {
        // A shared file and a per-SDK file at the same URL would silently
        // shadow each other and reintroduce drift — fail the build instead.
        throw new Error(
          `docs-manifest: slug ${slug} is produced by both ${existing} and ${rel}`,
        );
      }
      sources.set(slug, rel);
      metas.push({ slug, title: title || slug, description, canonical });
    }
  }
  return metas.sort((a, b) => a.slug.localeCompare(b.slug));
}

export function docsManifest(): Plugin {
  return {
    name: "docs-manifest",
    resolveId(id) {
      if (id === VIRTUAL_ID) {
        return RESOLVED_ID;
      }
    },
    load(id) {
      if (id === RESOLVED_ID) {
        return `export const DOCS = ${JSON.stringify(buildManifest())};`;
      }
    },
  };
}
