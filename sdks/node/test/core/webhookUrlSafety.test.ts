import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  assertSafeWebhookUrl,
  assertSafeWebhookUrlSync,
  Queue,
  UnsafeWebhookUrlError,
  WebhookValidationError,
} from "../../src/index";

const ALLOW_ENV_VAR = "TASKITO_WEBHOOKS_ALLOW_PRIVATE";

let saved: string | undefined;
let target: Server | undefined;

beforeEach(() => {
  saved = process.env[ALLOW_ENV_VAR];
  delete process.env[ALLOW_ENV_VAR];
});

afterEach(() => {
  if (saved === undefined) {
    delete process.env[ALLOW_ENV_VAR];
  } else {
    process.env[ALLOW_ENV_VAR] = saved;
  }
  target?.close();
  target = undefined;
});

function newQueue(): Queue {
  return new Queue({ dbPath: join(mkdtempSync(join(tmpdir(), "taskito-ssrf-")), "q.db") });
}

const UNSAFE_URLS = [
  "http://127.0.0.1/hook",
  "http://127.9.9.9/hook",
  "http://0.0.0.0/hook",
  "http://10.1.2.3/hook",
  "http://172.16.0.1/hook",
  "http://192.168.1.10/hook",
  "http://169.254.169.254/latest/meta-data", // cloud metadata
  "http://100.64.0.1/hook", // CGNAT
  "http://[::1]/hook",
  "http://[fe80::1]/hook",
  "http://[fc00::1]/hook",
  "http://[::ffff:127.0.0.1]/hook", // IPv4-mapped loopback
  "http://localhost/hook",
  "http://db.internal/hook",
  "http://box.local/hook",
];

it("rejects private, loopback, and local-only destinations", () => {
  for (const url of UNSAFE_URLS) {
    expect(() => assertSafeWebhookUrlSync(url), url).toThrow(UnsafeWebhookUrlError);
  }
});

it("accepts public destinations", () => {
  expect(() => assertSafeWebhookUrlSync("https://example.com/hook")).not.toThrow();
  expect(() => assertSafeWebhookUrlSync("http://93.184.216.34/hook")).not.toThrow();
});

it("rejects non-http schemes and hostless urls even when the guard is bypassed", () => {
  expect(() => assertSafeWebhookUrlSync("ftp://example.com/hook", { allowPrivate: true })).toThrow(
    UnsafeWebhookUrlError,
  );
  expect(() => assertSafeWebhookUrlSync("not-a-url", { allowPrivate: true })).toThrow(
    UnsafeWebhookUrlError,
  );
});

it("bypasses the address checks when allow-private is set", () => {
  expect(() => assertSafeWebhookUrlSync("http://127.0.0.1:9000/hook")).toThrow();
  process.env[ALLOW_ENV_VAR] = "1";
  expect(() => assertSafeWebhookUrlSync("http://127.0.0.1:9000/hook")).not.toThrow();
});

it("treats falsy environment values as guard-enabled", () => {
  for (const value of ["", "0", "false", "no", "off"]) {
    process.env[ALLOW_ENV_VAR] = value;
    expect(() => assertSafeWebhookUrlSync("http://127.0.0.1/hook"), value).toThrow();
  }
});

it("checks literal addresses on the async path too", async () => {
  await expect(assertSafeWebhookUrl("http://192.168.1.10/hook")).rejects.toBeInstanceOf(
    UnsafeWebhookUrlError,
  );
  await expect(assertSafeWebhookUrl("http://[::1]/hook")).rejects.toBeInstanceOf(
    UnsafeWebhookUrlError,
  );
  process.env[ALLOW_ENV_VAR] = "1";
  await expect(assertSafeWebhookUrl("http://192.168.1.10/hook")).resolves.toBeUndefined();
});

it("refuses to register a webhook pointed at the metadata service", () => {
  const queue = newQueue();
  expect(() => queue.webhooks.create({ url: "http://169.254.169.254/latest/meta-data" })).toThrow(
    WebhookValidationError,
  );
  expect(queue.webhooks.list()).toHaveLength(0);
});

it("blocks delivery when a registered url becomes unsafe", async () => {
  process.env[ALLOW_ENV_VAR] = "1";
  const queue = newQueue();
  const webhook = queue.webhooks.create({ url: "http://127.0.0.1:9/hook", maxRetries: 2 });

  // The guard is re-evaluated per attempt, so revoking the bypass after
  // registration stands in for DNS being rebound to a private address.
  delete process.env[ALLOW_ENV_VAR];
  const delivery = await queue.webhooks.test(webhook.id);

  expect(delivery?.status).toBe("failed");
  expect(delivery?.ok).toBe(false);
  expect(delivery?.attempts).toBe(0);
  expect(delivery?.error).toMatch(/private or reserved/);
});

it("does not follow redirects out of the validated destination", async () => {
  process.env[ALLOW_ENV_VAR] = "1";
  const port = await new Promise<number>((resolve) => {
    const server = createServer((_req, res) => {
      res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data" }).end();
    });
    target = server;
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  });
  const queue = newQueue();
  const webhook = queue.webhooks.create({ url: `http://127.0.0.1:${port}/hook`, maxRetries: 2 });

  const delivery = await queue.webhooks.test(webhook.id);

  expect(delivery?.status).toBe("failed");
  expect(delivery?.attempts).toBe(1);
  expect(delivery?.error).toMatch(/redirect not followed/);
});
