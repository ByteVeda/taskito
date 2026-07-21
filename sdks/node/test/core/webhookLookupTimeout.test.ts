import { expect, it, vi } from "vitest";
import { UnsafeWebhookUrlError } from "../../src/webhooks/errors";
import { createSafeLookup } from "../../src/webhooks/urlSafety";

// Its own file because the mock replaces DNS for the whole module graph: a
// resolver that never answers, so only the bound can end the lookup.
vi.mock("node:dns/promises", () => ({ lookup: () => new Promise(() => {}) }));

it("bounds the lookup so an unresponsive resolver cannot stall a delivery", async () => {
  const error = await new Promise<Error | null>((resolve) => {
    createSafeLookup({ timeoutMs: 5 })("slow.example", { all: true }, (cause) => resolve(cause));
  });

  expect(error?.message).toMatch(/timed out after 5ms/);
  // Transient, so the deliverer retries it rather than refusing the webhook.
  expect(error).not.toBeInstanceOf(UnsafeWebhookUrlError);
});
