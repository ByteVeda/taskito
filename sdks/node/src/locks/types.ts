import type { JsLockInfo } from "../native";

/** Holder info for a distributed lock. Timestamps are Unix milliseconds. */
export type LockInfo = JsLockInfo;

/** Options for {@link Queue.lock}. */
export interface LockOptions {
  /** Time-to-live before the lock auto-expires (ms). Default 30000. */
  ttlMs?: number;
  /** Owner token. Defaults to a random UUID; only the owner can release/extend. */
  ownerId?: string;
  /** Renew the lock at `ttlMs / 3` while held (default true). */
  autoExtend?: boolean;
}
