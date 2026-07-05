import type { Server } from "node:http";
import { fileURLToPath } from "node:url";
import type { Queue } from "../index";
import { createLogger } from "../utils";
import type { DashboardAuth } from "./auth";
import { createDashboardServer } from "./server";

const log = createLogger("dashboard");

export interface DashboardOptions {
  /** Port to listen on (default 8787). */
  port?: number;
  /** Host to bind (default 127.0.0.1). */
  host?: string;
  /** Path to the built SPA assets. Defaults to the package's bundled `static/dashboard`. */
  staticDir?: string;
  /**
   * Require a bearer token on every `/api/*` request (except `/api/auth/status`).
   * Omit for open mode. Open `/?token=<token>` once to use the SPA behind it.
   */
  auth?: DashboardAuth;
}

// Built relative to dist/ at runtime. The path is assembled dynamically so the
// bundler does not treat it as a static asset import.
const STATIC_REL = ["..", "static", "dashboard"].join("/");
const defaultStaticDir = (): string => fileURLToPath(new URL(STATIC_REL, import.meta.url));

/**
 * Start the web dashboard over `queue` — serves the React SPA plus a JSON API.
 * Returns the listening HTTP server; call `.close()` to stop it.
 */
export function serveDashboard(queue: Queue, options: DashboardOptions = {}): Server {
  const server = createDashboardServer(
    queue,
    options.staticDir ?? defaultStaticDir(),
    options.auth,
  );
  // A bind failure (e.g. EADDRINUSE) without an 'error' listener crashes the process.
  server.on("error", (error) => {
    log.error(() => "dashboard server error", error);
  });
  server.listen(options.port ?? 8787, options.host ?? "127.0.0.1");
  return server;
}

export type { DashboardAuth } from "./auth";
export { createDashboardHandler, createDashboardServer } from "./server";
