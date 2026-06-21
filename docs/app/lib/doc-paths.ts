import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Filesystem walk of the MDX content tree, used by react-router.config's
// `prerender()` to enumerate every static doc URL at build time. The runtime
// router (app/lib/content.ts) maps the same files via import.meta.glob — both
// derive slugs identically so the prerendered set matches the served routes.

const CONTENT_DIR = fileURLToPath(
  new URL("../../content/docs", import.meta.url),
);

/** `content/docs/a/b.mdx` → `/a/b`; `…/a/index.mdx` → `/a`. */
export function fileToDocPath(absFile: string): string {
  const rel = relative(CONTENT_DIR, absFile).replace(/\.mdx$/, "");
  const parts = rel.split(sep);
  if (parts[parts.length - 1] === "index") {
    parts.pop();
  }
  return `/${parts.join("/")}`.replace(/\/$/, "") || "/";
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

/** Every doc URL (e.g. `/getting-started/installation`, `/node/workflows/saga`). */
export function allDocPaths(): string[] {
  const files: string[] = [];
  walk(CONTENT_DIR, files);
  return files.map(fileToDocPath).filter((p) => p !== "/");
}
