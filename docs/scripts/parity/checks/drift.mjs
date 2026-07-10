import { isSdk } from "../../../app/lib/sdk-registry.ts";
import { wordCount } from "../content.mjs";

// (b) Informational migration queue: the same topic living in ≥2 per-SDK trees
// is drift-prone by construction. Report prose word counts and flag ratios
// above DRIFT_RATIO as shared-file migration candidates, worst first. Never
// fails the run — per-SDK topics are legitimate until migrated or exempted.

const DRIFT_RATIO = 2;

// Known filename mismatches for the same topic across SDK trees.
const NAME_EQUIVALENTS = new Map([
  ["guides/reliability/locking", "guides/reliability/locks"],
  ["guides/workflows/sagas", "guides/workflows/saga"],
  ["guides/operations/autoscaler", "guides/operations/autoscaling"],
]);

function topicOf(rel) {
  const [head, ...rest] = rel.split("/");
  if (!isSdk(head) || rest.length === 0) {
    return null;
  }
  const topic = rest.join("/").replace(/\.mdx$/, "");
  return { sdk: head, topic: NAME_EQUIVALENTS.get(topic) ?? topic };
}

export function checkDrift(files) {
  const byTopic = new Map(); // topic → Map<sdk, words>
  for (const file of files) {
    if (!file.rel.endsWith(".mdx")) {
      continue;
    }
    const entry = topicOf(file.rel);
    if (!entry) {
      continue;
    }
    const perSdk = byTopic.get(entry.topic) ?? new Map();
    perSdk.set(entry.sdk, wordCount(file.raw));
    byTopic.set(entry.topic, perSdk);
  }

  const flagged = [];
  for (const [topic, perSdk] of byTopic) {
    if (perSdk.size < 2) {
      continue;
    }
    const counts = [...perSdk.values()];
    const ratio = Math.max(...counts) / Math.max(1, Math.min(...counts));
    if (ratio > DRIFT_RATIO) {
      const cells = [...perSdk]
        .map(([sdk, words]) => `${sdk}:${words}`)
        .join(" ");
      flagged.push({ topic, ratio, line: `${topic}  (${cells})` });
    }
  }
  flagged.sort((a, b) => b.ratio - a.ratio);

  const report =
    flagged.length === 0
      ? ["no drifted per-SDK topics — migration complete"]
      : [
          `${flagged.length} per-SDK topics exceed ${DRIFT_RATIO}x word-count drift (migration candidates, worst first):`,
          ...flagged.map((f) => `  ${f.ratio.toFixed(1)}x  ${f.line}`),
        ];
  return { name: "Drift report (informational)", errors: [], report };
}
