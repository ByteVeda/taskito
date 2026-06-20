import { randomUUID } from "node:crypto";
import type { NativeQueue } from "../native";
import { createLogger } from "../utils";
import type { LockInfo, LockOptions } from "./types";

const DEFAULT_TTL_MS = 30_000;
const log = createLogger("locks");

/**
 * A TTL-bounded, owner-scoped distributed lock backed by the queue's storage.
 *
 * While held it auto-extends at `ttlMs / 3` so a slow critical section doesn't
 * lose the lock; if extension ever fails (the lock expired or was stolen) the
 * renewal stops. Implements `Symbol.dispose`, so it also works with `using`:
 *
 * ```ts
 * using lock = queue.lock("report");
 * if (lock.acquire()) {
 *   // ... critical section; released automatically at block exit
 * }
 * ```
 */
export class Lock {
  readonly name: string;
  readonly ownerId: string;
  private readonly ttlMs: number;
  private readonly autoExtend: boolean;
  private timer?: ReturnType<typeof setInterval>;
  private held = false;

  constructor(
    private readonly native: NativeQueue,
    name: string,
    options: LockOptions = {},
  ) {
    this.name = name;
    const ttl = options.ttlMs ?? DEFAULT_TTL_MS;
    if (!Number.isFinite(ttl) || ttl <= 0) {
      throw new RangeError(`Lock ttlMs must be a positive finite number, got ${ttl}`);
    }
    this.ttlMs = Math.floor(ttl);
    this.ownerId = options.ownerId ?? randomUUID();
    this.autoExtend = options.autoExtend ?? true;
  }

  /** Whether this handle currently believes it holds the lock. */
  get locked(): boolean {
    return this.held;
  }

  /** Try to acquire. Returns false if another owner holds a live lock. */
  acquire(): boolean {
    if (this.held) {
      // Re-validate the lease rather than trusting local state indefinitely:
      // with autoExtend off the remote lock may have already expired. `extend`
      // succeeds only if we still hold it; otherwise fall through to re-acquire.
      if (this.extend()) {
        return true;
      }
      this.held = false;
      this.stopAutoExtend();
    }
    const ok = this.native.acquireLock(this.name, this.ownerId, this.ttlMs);
    if (ok) {
      this.held = true;
      this.startAutoExtend();
    }
    return ok;
  }

  /** Release if held. Returns false if this handle was not the holder. */
  release(): boolean {
    this.stopAutoExtend();
    if (!this.held) {
      return false;
    }
    this.held = false;
    return this.native.releaseLock(this.name, this.ownerId);
  }

  /** Extend the TTL (defaults to the original `ttlMs`). Returns false if not held. */
  extend(ttlMs: number = this.ttlMs): boolean {
    return this.native.extendLock(this.name, this.ownerId, ttlMs);
  }

  /** Current holder info, or `undefined` if the lock is free. */
  info(): LockInfo | undefined {
    return this.native.getLockInfo(this.name) ?? undefined;
  }

  [Symbol.dispose](): void {
    this.release();
  }

  private startAutoExtend(): void {
    if (!this.autoExtend) {
      return;
    }
    const interval = Math.max(1, Math.floor(this.ttlMs / 3));
    this.timer = setInterval(() => {
      if (!this.extend()) {
        // Lost the lock (expired or stolen) — stop renewing.
        log.warn(() => `lost lock '${this.name}' during auto-extend`);
        this.held = false;
        this.stopAutoExtend();
      }
    }, interval);
    this.timer.unref();
  }

  private stopAutoExtend(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}
