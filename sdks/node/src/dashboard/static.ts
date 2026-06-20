// Serve the built React SPA (`dashboard/` build output) with SPA-deep-link
// fallback to index.html — mirrors the Python dashboard's static.py.

import { createReadStream, existsSync, statSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { pipeline } from "node:stream";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

export class StaticAssets {
  constructor(private readonly root: string) {}

  /** Whether a built SPA is present. */
  available(): boolean {
    return existsSync(join(this.root, "index.html"));
  }

  /**
   * Serve `reqPath`. Unknown non-`/assets/` paths fall back to `index.html`
   * (client-side routing). Returns false only when no SPA is built.
   */
  serve(reqPath: string, res: ServerResponse): boolean {
    const direct = this.resolve(reqPath === "/" ? "/index.html" : reqPath);
    if (direct) {
      send(res, direct);
      return true;
    }
    // Hashed asset filenames never rewrite, so a miss is a real 404.
    if (reqPath.startsWith("/assets/")) {
      res.writeHead(404).end();
      return true;
    }
    const index = this.resolve("/index.html");
    if (index) {
      send(res, index);
      return true;
    }
    return false;
  }

  private resolve(reqPath: string): string | undefined {
    const rel = normalize(reqPath).replace(/^[/\\]+/, "");
    if (rel.includes("..")) {
      return undefined;
    }
    const file = join(this.root, rel);
    if (file !== this.root && !file.startsWith(this.root + sep)) {
      return undefined;
    }
    return existsSync(file) && statSync(file).isFile() ? file : undefined;
  }
}

function send(res: ServerResponse, file: string): void {
  const type = CONTENT_TYPES[extname(file)] ?? "application/octet-stream";
  const immutable = file.includes(`${sep}assets${sep}`);
  res.writeHead(200, {
    "content-type": type,
    "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
  });
  // pipeline handles stream errors (e.g. a TOCTOU delete after the existsSync
  // check) — destroy the response instead of crashing the request handler.
  pipeline(createReadStream(file), res, (error) => {
    if (error) {
      res.destroy();
    }
  });
}
