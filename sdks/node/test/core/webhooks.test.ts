import { createHmac } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { Queue, WebhookValidationError, type Worker } from "../../src/index";

// These deliveries target a loopback receiver, which the SSRF guard blocks by default.
process.env.TASKITO_WEBHOOKS_ALLOW_PRIVATE = "1";

let worker: Worker | undefined;
let target: Server | undefined;

afterEach(() => {
  worker?.stop();
  worker = undefined;
  target?.close();
  target = undefined;
});

function newQueue(): Queue {
  return new Queue({ dbPath: join(mkdtempSync(join(tmpdir(), "taskito-wh-")), "q.db") });
}

interface Received {
  body: string;
  signature?: string;
}

function startTarget(received: Received[]): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        const signature = req.headers["x-taskito-signature"];
        received.push({ body, signature: typeof signature === "string" ? signature : undefined });
        res.writeHead(200).end();
      });
    });
    target = server;
    server.listen(0, () => resolve((server.address() as AddressInfo).port));
  });
}

it("delivers a signed webhook when a job completes", async () => {
  const received: Received[] = [];
  const port = await startTarget(received);
  const queue = newQueue();
  const secret = "s3cr3t";
  queue.webhooks.create({
    url: `http://127.0.0.1:${port}/hook`,
    events: ["job.completed"],
    secret,
  });
  queue.task("add", (a: number, b: number) => a + b);
  queue.enqueue("add", [2, 3]);
  worker = queue.runWorker();

  for (let i = 0; i < 100 && received.length === 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const first = received[0];
  expect(first).toBeDefined();
  if (!first) {
    return;
  }
  const payload = JSON.parse(first.body) as { event: string; taskName: string };
  expect(payload.event).toBe("job.completed");
  expect(payload.taskName).toBe("add");
  const expected = `sha256=${createHmac("sha256", secret).update(first.body).digest("hex")}`;
  expect(first.signature).toBe(expected);
});

it("creates, lists, and deletes webhooks", () => {
  const queue = newQueue();
  const hook = queue.webhooks.create({ url: "http://example.com/h", events: [] });
  expect(queue.webhooks.list().map((w) => w.id)).toContain(hook.id);
  expect(queue.webhooks.delete(hook.id)).toBe(true);
  expect(queue.webhooks.list().map((w) => w.id)).not.toContain(hook.id);
});

it("rejects malformed webhook definitions before persisting", () => {
  const queue = newQueue();
  expect(() => queue.webhooks.create({ url: "", events: [] })).toThrow(WebhookValidationError);
  expect(() => queue.webhooks.create({ url: "not-a-url", events: [] })).toThrow(/not a valid URL/);
  expect(() =>
    queue.webhooks.create({ url: "https://x.test", events: [], maxRetries: -1 }),
  ).toThrow(/maxRetries/);
  expect(() => queue.webhooks.create({ url: "https://x.test", events: [], timeoutMs: 0 })).toThrow(
    /timeout/,
  );
  expect(queue.webhooks.list()).toHaveLength(0);
});
