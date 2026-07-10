import { SEARCH_DOCS, type SearchDoc } from "./search";

// Shared pages mount at one URL per SDK; list each only once, at its
// canonical (default-SDK) URL, so the corpus carries no duplicates.
function uniqueDocs(): SearchDoc[] {
  return SEARCH_DOCS.filter(
    (doc) => !doc.canonical || doc.canonical === doc.id,
  ).sort((a, b) => a.id.localeCompare(b.id));
}

/** Index of every doc page (title + URL) — the `/llms.txt` body. */
export function llmsIndex(): string {
  const lines = ["# Taskito documentation", ""];
  for (const doc of uniqueDocs()) {
    lines.push(`- [${doc.title}](${doc.id})`);
  }
  return `${lines.join("\n")}\n`;
}

/** Full corpus (title + stripped body per page) — the `/llms-full.txt` body. */
export function llmsFull(): string {
  const blocks = uniqueDocs().map(
    (doc) => `## ${doc.title}\nURL: ${doc.id}\n\n${doc.text}\n`,
  );
  return `# Taskito documentation (full text)\n\n${blocks.join("\n---\n\n")}`;
}
