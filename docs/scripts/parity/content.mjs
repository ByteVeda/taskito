import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Content-tree access shared by every parity check. Slug/fan-out logic is NOT
// reimplemented here — checks import it from app/lib/doc-slugs.ts (Node strips
// the erasable TS types at import time), so the CI checks and the site always
// agree on how files map to URLs.

export const CONTENT_DIR = fileURLToPath(
  new URL("../../content/docs", import.meta.url),
);

/** One content file: posix content-relative path + raw text. */
export function loadContentFiles() {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".mdx") || entry.name === "meta.json") {
        files.push({
          rel: relative(CONTENT_DIR, full).split(sep).join("/"),
          raw: readFileSync(full, "utf8"),
        });
      }
    }
  };
  walk(CONTENT_DIR);
  return files;
}

/** Prose word count of an MDX body — frontmatter and code fences stripped. */
export function wordCount(raw) {
  const body = raw
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .replace(/```[\s\S]*?```/g, " ");
  return body.split(/\s+/).filter(Boolean).length;
}
