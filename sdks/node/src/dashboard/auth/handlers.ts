// Session-auth route handlers: setup, login, logout, whoami, change-password.
// Cookie side effects (set/clear) are applied by the server, which reads the
// session off login results and redacts the raw token from the JSON body.

import type { Queue } from "../../index";
import { BadRequestError, NotFoundError } from "../errors";
import type { RequestContext } from "./context";
import { AuthStore, type DashboardSession, type DashboardUser } from "./store";

function requireField(body: unknown, key: string): string {
  const value = (body as Record<string, unknown> | undefined)?.[key];
  if (typeof value !== "string" || !value) {
    throw new BadRequestError(`missing or empty field '${key}'`);
  }
  return value;
}

function serializeUser(user: DashboardUser) {
  return {
    username: user.username,
    role: user.role,
    created_at: user.createdAt,
    last_login_at: user.lastLoginAt,
  };
}

function serializeSession(session: DashboardSession) {
  return {
    username: session.username,
    role: session.role,
    expires_at: session.expiresAt,
    csrf_token: session.csrfToken,
  };
}

/** Public: whether the SPA should show the first-run setup page. */
export function authStatus(queue: Queue) {
  return { auth_enabled: true, setup_required: new AuthStore(queue).countUsers() === 0 };
}

/** Create the first admin user. Only callable when zero users exist. */
export async function setup(queue: Queue, body: unknown) {
  const store = new AuthStore(queue);
  if (store.countUsers() > 0) {
    throw new BadRequestError("setup already complete");
  }
  const username = requireField(body, "username");
  const password = requireField(body, "password");
  // Store-level ValidationError propagates to the server, which maps it to 400.
  const user = await store.createUser(username, password, "admin");
  return { user: serializeUser(user) };
}

/**
 * Verify credentials and create a session. The same generic error covers
 * unknown user and bad password so neither is revealed. The `token` field is
 * consumed by the server (session cookie) and stripped from the response.
 */
export async function login(queue: Queue, body: unknown) {
  const store = new AuthStore(queue);
  if (store.countUsers() === 0) {
    throw new BadRequestError("setup_required");
  }
  const username = requireField(body, "username");
  const password = requireField(body, "password");
  const user = await store.authenticate(username, password);
  if (!user) {
    throw new BadRequestError("invalid_credentials");
  }
  const session = store.createSession(user);
  return {
    user: serializeUser(user),
    session: { ...serializeSession(session), token: session.token },
  };
}

/** Invalidate the current session. Idempotent. */
export function logout(queue: Queue, ctx: RequestContext) {
  if (ctx.session) {
    new AuthStore(queue).deleteSession(ctx.session.token);
  }
  return { ok: true };
}

/** The current user, or 404 `not_authenticated` without a valid session. */
export function whoami(queue: Queue, ctx: RequestContext) {
  if (!ctx.session) {
    throw new NotFoundError("not_authenticated");
  }
  const store = new AuthStore(queue);
  const user = store.getUser(ctx.session.username);
  if (!user) {
    // Session valid but user deleted — invalidate and treat as logged out.
    store.deleteSession(ctx.session.token);
    throw new NotFoundError("not_authenticated");
  }
  return {
    user: serializeUser(user),
    csrf_token: ctx.session.csrfToken,
    expires_at: ctx.session.expiresAt,
  };
}

/** Change the current user's password. Requires the old password. */
export async function changePassword(queue: Queue, body: unknown, ctx: RequestContext) {
  if (!ctx.session) {
    throw new BadRequestError("not_authenticated");
  }
  const oldPassword = requireField(body, "old_password");
  const newPassword = requireField(body, "new_password");
  const store = new AuthStore(queue);
  const user = await store.authenticate(ctx.session.username, oldPassword);
  if (!user) {
    throw new BadRequestError("invalid_credentials");
  }
  await store.updatePassword(user.username, newPassword);
  return { ok: true };
}
