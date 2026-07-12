import type { TopicSummary } from "@/lib/api-types";

export interface TopicTotals {
  topics: number;
  backlog: number;
  dead: number;
}

/**
 * Roll a topic list up into the summary counters shown in the page's stat
 * cards. Mirrors the server-side per-topic aggregation one level higher so
 * the header totals stay consistent with the table rows below them.
 */
export function topicTotals(topics: TopicSummary[] | undefined): TopicTotals {
  if (!topics) return { topics: 0, backlog: 0, dead: 0 };
  return topics.reduce<TopicTotals>(
    (acc, t) => ({
      topics: acc.topics + 1,
      backlog: acc.backlog + t.backlog,
      dead: acc.dead + t.dead,
    }),
    { topics: 0, backlog: 0, dead: 0 },
  );
}
