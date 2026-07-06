import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  FileProxyHandler,
  FileReference,
  Proxies,
  ProxyError,
  type ProxyHandler,
  type ProxyRef,
} from "../../src/index";

const KEY = Buffer.from("proxy-secret-key");

function fileProxies(allowedRoots: readonly string[] = []): Proxies {
  return new Proxies(KEY).register(new FileProxyHandler(allowedRoots));
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "taskito-proxies-"));
}

/** Simulate the wire: serialize the ref to JSON and parse it back. */
function overTheWire(ref: ProxyRef): ProxyRef {
  return JSON.parse(JSON.stringify(ref)) as ProxyRef;
}

describe("Proxies", () => {
  it("round-trips a file ref across the wire", () => {
    const proxies = fileProxies();
    const path = join(tempDir(), "data.txt");
    const ref = overTheWire(proxies.deconstruct(new FileReference(path)));
    expect(proxies.resolve<FileReference>(ref).path).toBe(resolve(path));
  });

  it("rejects a tampered ref", () => {
    const proxies = fileProxies();
    const ref = proxies.deconstruct(new FileReference(join(tempDir(), "a")));
    const tampered: ProxyRef = { ...ref, reference: { path: "/etc/passwd" } };
    expect(() => proxies.reconstruct(tampered)).toThrow(ProxyError);
    expect(() => proxies.reconstruct(tampered)).toThrow(/signature mismatch/);
  });

  it("enforces the allowlist", () => {
    const dir = tempDir();
    const proxies = fileProxies([dir]);
    const inside = join(dir, "ok.txt");
    expect(
      proxies.resolve<FileReference>(proxies.deconstruct(new FileReference(inside))).path,
    ).toBe(resolve(inside));
    const outside = join(dir, "..", "outside.txt");
    const ref = proxies.deconstruct(new FileReference(outside));
    expect(() => proxies.reconstruct(ref)).toThrow(/not in allowlist/);
  });

  it("rejects a symlinked-ancestor escape from the allowlist", () => {
    const dir = tempDir();
    const allowed = join(dir, "allowed");
    const secret = join(dir, "secret");
    for (const d of [allowed, secret]) {
      writeFileSync(join(mkdirp(d), ".keep"), "");
    }
    writeFileSync(join(secret, "data.txt"), "top secret");
    // A symlink inside the allowed root pointing at the secret dir: lexically
    // under the allowlist, but its real target is not.
    symlinkSync(secret, join(allowed, "link"), "dir");

    const proxies = fileProxies([allowed]);
    const ref = proxies.deconstruct(new FileReference(join(allowed, "link", "data.txt")));
    expect(() => proxies.reconstruct(ref)).toThrow(/not in allowlist/);
  });

  it("rejects a value with no handler", () => {
    expect(() => fileProxies().deconstruct({ not: "a file" })).toThrow(/no proxy handler/);
  });

  it("rejects an unknown handler on reconstruct", () => {
    const proxies = fileProxies();
    const ref = proxies.deconstruct(new FileReference("/tmp/x"));
    expect(() => proxies.reconstruct({ ...ref, handler: "nope" })).toThrow(/unknown proxy handler/);
  });

  it("rejects a null value on deconstruct", () => {
    expect(() => fileProxies().deconstruct(null)).toThrow(/cannot deconstruct null/);
  });

  it("rejects a duplicate handler id", () => {
    expect(() => fileProxies().register(new FileProxyHandler())).toThrow(/already registered/);
  });

  it("rejects an empty key", () => {
    expect(() => new Proxies(new Uint8Array())).toThrow(/must not be empty/);
  });

  it("round-trips within the TTL", () => {
    const proxies = fileProxies();
    const path = join(tempDir(), "ttl.txt");
    const ref = proxies.deconstruct(new FileReference(path), { ttlMs: 60_000 });
    expect(proxies.resolve<FileReference>(ref).path).toBe(resolve(path));
  });

  it("rejects an expired ref", async () => {
    const proxies = fileProxies();
    const ref = proxies.deconstruct(new FileReference("/tmp/x"), { ttlMs: 1 });
    await new Promise((r) => setTimeout(r, 20));
    expect(() => proxies.reconstruct(ref)).toThrow(/expired/);
  });

  it("rejects a tampered expiry", () => {
    const proxies = fileProxies();
    const ref = proxies.deconstruct(new FileReference("/tmp/x"), { ttlMs: 1 });
    const tampered: ProxyRef = { ...ref, expiresAtMs: Date.now() + 3_600_000 };
    expect(() => proxies.reconstruct(tampered)).toThrow(/signature mismatch/);
  });

  it("enforces the purpose when requested", () => {
    const proxies = fileProxies();
    const path = join(tempDir(), "p.txt");
    const ref = proxies.deconstruct(new FileReference(path), { purpose: "emails" });
    expect(proxies.resolve<FileReference>(ref, "emails").path).toBe(resolve(path));
    expect(proxies.resolve<FileReference>(ref).path).toBe(resolve(path)); // unchecked
    expect(() => proxies.reconstruct(ref, "billing")).toThrow(/purpose mismatch/);
  });

  it("dispatches to the first handler that accepts, in registration order", () => {
    const calls: string[] = [];
    const handler = (id: string): ProxyHandler<string> => ({
      id,
      handles: (value) => typeof value === "string",
      deconstruct: (value) => {
        calls.push(id);
        return { value };
      },
      reconstruct: (reference) => String(reference.value),
    });
    const proxies = new Proxies(KEY).register(handler("first")).register(handler("second"));
    expect(proxies.deconstruct("hello").handler).toBe("first");
    expect(calls).toEqual(["first"]);
  });
});

describe("canonicalJson", () => {
  it("sorts keys recursively and stays compact", () => {
    expect(canonicalJson({ b: { d: 1, c: 2 }, a: [3, { z: 4, y: 5 }] })).toBe(
      '{"a":[3,{"y":5,"z":4}],"b":{"c":2,"d":1}}',
    );
  });

  it("sorts integer-like keys lexically, not numerically", () => {
    expect(canonicalJson({ "10": "ten", "2": "two" })).toBe('{"10":"ten","2":"two"}');
  });

  it("drops undefined object values and nullifies undefined array items", () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(canonicalJson([undefined, 1])).toBe("[null,1]");
  });

  it("rejects non-safe-integer numbers", () => {
    expect(() => canonicalJson({ a: 1.5 })).toThrow(ProxyError);
    expect(() => canonicalJson({ a: Number.MAX_SAFE_INTEGER + 1 })).toThrow(/safe integers/);
  });
});

describe("cross-SDK contract", () => {
  it("produces the contract vector signature", () => {
    const proxies = fileProxies();
    const ref = proxies.deconstruct(new FileReference("/tmp/data.txt"));
    expect(ref.signature).toBe("FgmudNqaGsUBFsIKC4uBgtfZ+IAHrzBT+xRjUWGePyQ=");
  });
});

function mkdirp(dir: string): string {
  mkdirSync(dir, { recursive: true });
  return dir;
}
