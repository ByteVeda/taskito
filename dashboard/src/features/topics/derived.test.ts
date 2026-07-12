import { describe, expect, it } from "vitest";
import type { TopicSummary } from "@/lib/api-types";
import { topicTotals } from "./derived";

function topic(overrides: Partial<TopicSummary>): TopicSummary {
  return {
    topic: overrides.topic ?? "orders",
    subscription_count: overrides.subscription_count ?? 1,
    backlog: overrides.backlog ?? 0,
    dead: overrides.dead ?? 0,
  };
}

describe("topicTotals", () => {
  it("returns zeroes for undefined (pre-load) input", () => {
    expect(topicTotals(undefined)).toEqual({ topics: 0, backlog: 0, dead: 0 });
  });

  it("returns zeroes for an empty list", () => {
    expect(topicTotals([])).toEqual({ topics: 0, backlog: 0, dead: 0 });
  });

  it("sums backlog and dead across topics and counts them", () => {
    const totals = topicTotals([
      topic({ topic: "orders", backlog: 4, dead: 1 }),
      topic({ topic: "audit", backlog: 1, dead: 0 }),
      topic({ topic: "emails", backlog: 7, dead: 2 }),
    ]);
    expect(totals).toEqual({ topics: 3, backlog: 12, dead: 3 });
  });
});
