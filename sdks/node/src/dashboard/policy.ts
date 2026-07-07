// Auth policy for the dashboard API: which paths bypass the session gate,
// which methods need CSRF, and which actions are admin-only.

/** Exact paths that bypass the session/CSRF gate. */
export const PUBLIC_PATHS = new Set([
  "/api/auth/status",
  "/api/auth/login",
  "/api/auth/setup",
  "/api/auth/providers",
  "/health",
  "/readiness",
  "/metrics",
]);

/** Prefixes that bypass auth — OAuth paths carry a provider slot in the URL. */
export const PUBLIC_PATH_PREFIXES = ["/api/auth/oauth/start/", "/api/auth/oauth/callback/"];

/** State-changing paths a non-admin may call on their own session. */
const SELF_SERVICE_PATHS = new Set(["/api/auth/logout", "/api/auth/change-password"]);

/** Paths exempt from CSRF because no session exists yet. */
const CSRF_EXEMPT_PATHS = new Set(["/api/auth/login", "/api/auth/setup"]);

export function isPublicPath(path: string): boolean {
  return PUBLIC_PATHS.has(path) || PUBLIC_PATH_PREFIXES.some((p) => path.startsWith(p));
}

export function isStateChangingMethod(method: string): boolean {
  return method === "POST" || method === "PUT" || method === "DELETE" || method === "PATCH";
}

export function isCsrfExempt(path: string): boolean {
  return CSRF_EXEMPT_PATHS.has(path);
}

export function requiresAdmin(path: string, method: string): boolean {
  return isStateChangingMethod(method) && !SELF_SERVICE_PATHS.has(path);
}
