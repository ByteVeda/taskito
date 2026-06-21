import { SEARCH_DOCS } from "./search";

/** Index of every doc page (title + URL) — the `/llms.txt` body. */
export function llmsIndex(): string {
  const lines = ["# Taskito documentation", ""];
  for (const doc of [...SEARCH_DOCS].sort((a, b) => a.id.localeCompare(b.id))) {
    lines.push(`- [${doc.title}](${doc.id})`);
  }
  return `${lines.join("\n")}\n`;
}

/** Full corpus (title + stripped body per page) — the `/llms-full.txt` body. */
export function llmsFull(): string {
  const blocks = [...SEARCH_DOCS]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((doc) => `## ${doc.title}\nURL: ${doc.id}\n\n${doc.text}\n`);
  return `# Taskito documentation (full text)\n\n${blocks.join("\n---\n\n")}`;
}
