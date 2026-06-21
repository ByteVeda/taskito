import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

// Build-time manifest of doc pages: { slug, title, description } only — NO compiled
// components. nav/search/llms import this (via `virtual:docs-manifest`) instead of the
// component glob, so they never pull the 128 shiki-inflated MDX modules into a chunk.

const CONTENT_DIR = fileURLToPath(new URL("./content/docs", import.meta.url));
const VIRTUAL_ID = "virtual:docs-manifest";
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

export interface DocMeta {
  slug: string;
  title: string;
  description: string;
}

function slugOf(absFile: string): string {
  const rel = relative(CONTENT_DIR, absFile).replace(/\.mdx$/, "");
  const parts = rel.split(sep);
  if (parts[parts.length - 1] === "index") {
    parts.pop();
  }
  return `/${parts.join("/")}`.replace(/\/$/, "") || "/";
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
  return files
    .map((file) => {
      const { title, description } = parseFrontmatter(
        readFileSync(file, "utf8"),
      );
      const slug = slugOf(file);
      return { slug, title: title || slug, description };
    })
    .sort((a, b) => a.slug.localeCompare(b.slug));
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
