import {
  isSharedRelPath,
  mountsForRelPath,
} from "../../../app/lib/doc-slugs.ts";

// (c) Two content files must never produce the same URL — a shared file and a
// stale per-SDK file at one slug would silently shadow each other. The vite
// manifest plugin enforces the same rule at build time; this duplicate gives a
// friendlier pre-build message. Also warns on meta.json under shared/ (nav's
// META glob would pick it up and confuse section resolution).

export function checkCollisions(files) {
  const errors = [];
  const report = [];
  const bySlug = new Map();
  for (const file of files) {
    if (!file.rel.endsWith(".mdx")) {
      if (file.rel.endsWith("meta.json") && isSharedRelPath(file.rel)) {
        report.push(
          `WARN ${file.rel}: meta.json is not supported under shared/ — list shared pages in each SDK section's meta.json instead`,
        );
      }
      continue;
    }
    for (const { slug } of mountsForRelPath(file.rel)) {
      const existing = bySlug.get(slug);
      if (existing) {
        errors.push(
          `slug ${slug} produced by both ${existing} and ${file.rel}`,
        );
      } else {
        bySlug.set(slug, file.rel);
      }
    }
  }
  return { name: "Slug collisions", errors, report, slugs: bySlug };
}
