import type { Server } from "node:http";
import { fileURLToPath } from "node:url";
import type { Queue } from "../index";
import { createLogger } from "../utils";
import type { DashboardAuth } from "./auth";
import { bootstrapAdminFromEnv, OAuthFlow, oauthConfigFromEnv } from "./auth";
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
   * Legacy shared-token gate: require this bearer token on every `/api/*`
   * request (except `/api/auth/status`). When set, the session-auth login
   * flow is disabled. Open `/?token=<token>` once to use the SPA behind it.
   */
  auth?: DashboardAuth;
  /**
   * Mark session cookies `Secure` so browsers only send them over HTTPS
   * (default true). Disable only for plain-HTTP development.
   */
  secureCookies?: boolean;
  /**
   * OAuth login flow. When omitted, one is built from the
   * `TASKITO_DASHBOARD_OAUTH_*` environment variables if they are set.
   */
  oauth?: OAuthFlow;
}

// Built relative to dist/ at runtime. The path is assembled dynamically so the
// bundler does not treat it as a static asset import.
const STATIC_REL = ["..", "static", "dashboard"].join("/");
const defaultStaticDir = (): string => fileURLToPath(new URL(STATIC_REL, import.meta.url));

/**
 * Start the web dashboard over `queue` — serves the React SPA plus a JSON API.
 * Without `auth`, the dashboard runs the full session flow: first-run setup,
 * password login, CSRF protection, and admin/viewer roles. An initial admin
 * can be bootstrapped from `TASKITO_DASHBOARD_ADMIN_USER` /
 * `TASKITO_DASHBOARD_ADMIN_PASSWORD`.
 * Returns the listening HTTP server; call `.close()` to stop it.
 */
export function serveDashboard(queue: Queue, options: DashboardOptions = {}): Server {
  if (!options.auth) {
    void bootstrapAdminFromEnv(queue).catch((error) => {
      log.warn(() => `admin bootstrap failed: ${String(error)}`);
    });
  }
  const server = createDashboardServer(queue, options.staticDir ?? defaultStaticDir(), {
    auth: options.auth,
    secureCookies: options.secureCookies,
    oauth: options.oauth ?? (options.auth ? undefined : buildOauthFlowFromEnv(queue)),
  });
  // A bind failure (e.g. EADDRINUSE) without an 'error' listener crashes the process.
  server.on("error", (error) => {
    log.error(() => "dashboard server error", error);
  });
  server.listen(options.port ?? 8787, options.host ?? "127.0.0.1");
  return server;
}

export type { DashboardAuth } from "./auth";
export {
  AuthStore,
  bootstrapAdminFromEnv,
  type DashboardSession,
  type DashboardUser,
  type OAuthConfig,
  OAuthConfigError,
  OAuthFlow,
  type OAuthProvider,
  oauthConfigFromEnv,
  type ProviderIdentity,
} from "./auth";
export {
  createDashboardHandler,
  createDashboardServer,
  type DashboardHandlerOptions,
} from "./server";

/** Build the OAuth flow from env; invalid config logs and disables OAuth. */
function buildOauthFlowFromEnv(queue: Queue): OAuthFlow | undefined {
  try {
    const config = oauthConfigFromEnv();
    if (!config || !(config.google || config.github || config.oidc.length > 0)) {
      return undefined;
    }
    return new OAuthFlow(queue, config);
  } catch (error) {
    log.warn(() => `OAuth disabled — invalid configuration: ${String(error)}`);
    return undefined;
  }
}
