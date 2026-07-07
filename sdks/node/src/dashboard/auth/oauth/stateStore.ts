// Short-lived store for in-flight OAuth flows. State/nonce/PKCE-verifier
// triples live under `auth:oauth_state:<state>` in the settings KV (the
// cross-SDK key namespace) and are single-use: consume() always deletes.

import { randomBytes } from "node:crypto";
import type { Queue } from "../../../index";

const STATE_PREFIX = "auth:oauth_state:";
/** 5 min — covers consent UX + reasonable network latency. */
const DEFAULT_STATE_TTL_SECONDS = 5 * 60;

const STATE_TOKEN_BYTES = 32;
const NONCE_BYTES = 16;
// RFC 7636 §4.1: 32 bytes yields 43 base64url chars, above the 43-char minimum.
const CODE_VERIFIER_BYTES = 32;

/** One in-flight OAuth flow, stored server-side until callback or expiry. */
export interface OAuthState {
  state: string;
  nonce: string;
  codeVerifier: string;
  slot: string;
  nextUrl: string;
  createdAt: number;
  expiresAt: number;
}

/** Persisted snake_case row (cross-SDK contract; `state` is the key). */
interface StateRow {
  nonce: string;
  code_verifier: string;
  slot: string;
  next_url: string;
  created_at: number;
  expires_at: number;
}

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

/** Create, consume (read+delete), and prune short-lived OAuth state rows. */
export class OAuthStateStore {
  constructor(private readonly queue: Queue) {}

  /** Mint a fresh state/nonce/verifier triple and persist it. */
  create(slot: string, nextUrl: string, ttlSeconds = DEFAULT_STATE_TTL_SECONDS): OAuthState {
    const now = nowSeconds();
    const state: OAuthState = {
      state: randomBytes(STATE_TOKEN_BYTES).toString("base64url"),
      nonce: randomBytes(NONCE_BYTES).toString("base64url"),
      codeVerifier: randomBytes(CODE_VERIFIER_BYTES).toString("base64url"),
      slot,
      nextUrl,
      createdAt: now,
      expiresAt: now + ttlSeconds,
    };
    const row: StateRow = {
      nonce: state.nonce,
      code_verifier: state.codeVerifier,
      slot: state.slot,
      next_url: state.nextUrl,
      created_at: state.createdAt,
      expires_at: state.expiresAt,
    };
    this.queue.setSetting(STATE_PREFIX + state.state, JSON.stringify(row));
    return state;
  }

  /**
   * Look up `stateToken` and delete it. Returns `undefined` for missing,
   * malformed, or expired rows. The row is deleted before parsing so a
   * replayed state never re-validates.
   */
  consume(stateToken: string): OAuthState | undefined {
    if (!stateToken) {
      return undefined;
    }
    const key = STATE_PREFIX + stateToken;
    const raw = this.queue.getSetting(key);
    if (!raw) {
      return undefined;
    }
    this.queue.deleteSetting(key);
    let row: StateRow;
    try {
      row = JSON.parse(raw);
    } catch {
      return undefined;
    }
    if (
      typeof row?.nonce !== "string" ||
      typeof row.code_verifier !== "string" ||
      typeof row.slot !== "string" ||
      typeof row.expires_at !== "number"
    ) {
      return undefined;
    }
    if (nowSeconds() >= row.expires_at) {
      return undefined;
    }
    return {
      state: stateToken,
      nonce: row.nonce,
      codeVerifier: row.code_verifier,
      slot: row.slot,
      nextUrl: typeof row.next_url === "string" ? row.next_url : "/",
      createdAt: row.created_at ?? 0,
      expiresAt: row.expires_at,
    };
  }

  /** Best-effort sweep of expired state rows. Returns count removed. */
  pruneExpired(): number {
    const now = nowSeconds();
    let removed = 0;
    for (const [key, value] of Object.entries(this.queue.listSettings())) {
      if (!key.startsWith(STATE_PREFIX)) {
        continue;
      }
      let expiresAt: number;
      try {
        expiresAt = Number(JSON.parse(value)?.expires_at ?? 0);
      } catch {
        continue;
      }
      if (!Number.isFinite(expiresAt) || expiresAt <= now) {
        this.queue.deleteSetting(key);
        removed += 1;
      }
    }
    return removed;
  }
}
