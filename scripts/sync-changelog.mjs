#!/usr/bin/env node
// Generate the docs changelog page from the canonical root CHANGELOG.md.
//
// CHANGELOG.md (Keep a Changelog) is the single source of truth — edit it there.
// This script wraps its body in the frontmatter the docs site needs and writes
// docs/content/docs/resources/changelog.mdx. Run automatically before `docs` dev/build.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repoRoot = new URL("../", import.meta.url);
const source = fileURLToPath(new URL("CHANGELOG.md", repoRoot));
const target = fileURLToPath(
  new URL("docs/content/docs/resources/changelog.mdx", repoRoot),
);

// Drop the top-level "# Changelog" heading — the frontmatter title renders it.
const body = readFileSync(source, "utf8").replace(/^#\s+Changelog\s*\n/, "").trimStart();

const frontmatter = [
  "---",
  "title: Changelog",
  'description: "Release history for taskito — every notable change, fix, and feature."',
  "---",
  "",
  "{/* AUTO-GENERATED from /CHANGELOG.md by scripts/sync-changelog.mjs — do not edit directly. */}",
  "",
].join("\n");

writeFileSync(target, `${frontmatter}\n${body}\n`);
console.log(`synced ${target} from CHANGELOG.md`);
