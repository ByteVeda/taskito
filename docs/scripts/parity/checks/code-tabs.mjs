import { isSharedRelPath } from "../../../app/lib/doc-slugs.ts";
import { SDK_IDS } from "../../../app/lib/sdk-registry.ts";

// (a) Every <CodeTabs> block in a shared page must carry a <Tab sdk="…"> for
// every SDK — a missing tab renders as a silent hole for that SDK's readers.
// Opt out per block with data-parity-exempt (e.g. a feature one SDK lacks).
// Blocking: the shared tree starts empty, so there is no legacy debt.

const BLOCK_RE = /<CodeTabs[^>]*>[\s\S]*?<\/CodeTabs>/g;
const TAB_RE = /<Tab\s+sdk="([a-z]+)"/g;

export function checkCodeTabs(files) {
  const errors = [];
  for (const file of files) {
    if (!isSharedRelPath(file.rel) || !file.rel.endsWith(".mdx")) {
      continue;
    }
    for (const block of file.raw.match(BLOCK_RE) ?? []) {
      if (block.includes("data-parity-exempt")) {
        continue;
      }
      const present = new Set(
        [...block.matchAll(TAB_RE)].map((match) => match[1]),
      );
      const missing = SDK_IDS.filter((sdk) => !present.has(sdk));
      if (missing.length > 0) {
        const heading = block.slice(0, 80).replace(/\s+/g, " ");
        errors.push(
          `${file.rel}: CodeTabs missing <Tab sdk> for [${missing.join(", ")}] near "${heading}…"`,
        );
      }
    }
  }
  return { name: "CodeTabs SDK coverage (shared pages)", errors, report: [] };
}
