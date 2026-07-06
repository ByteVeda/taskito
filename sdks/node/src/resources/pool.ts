import { ResourceUnavailableError } from "../errors";
import { createLogger } from "../utils";
import type { PoolOptions, PoolStats } from "./types";

const log = createLogger("resources");

const DEFAULT_POOL_SIZE = 4;
const DEFAULT_ACQUIRE_TIMEOUT_MS = 10_000;

/** Lifecycle callbacks so the runtime's created/disposed counters stay accurate. */
export interface PoolHooks {
  /** Called after the factory builds an instance. */
  onCreated?: () => void;
  /** Called after an instance is actually disposed (eviction / shutdown). */
  onDisposed?: () => void;
}

/** An instance waiting in the pool, stamped when it (re-)entered the idle list. */
interface IdleEntry {
  instance: unknown;
  createdAt: number;
}

/** A pending `acquire` waiting for a permit; granted FIFO by `release`. */
interface Waiter {
  grant: () => void;
}

/**
 * Promise-based counting semaphore with FIFO waiters and per-waiter timeout.
 * `acquire` resolves `false` on timeout — never rejects — so the pool decides
 * what a timeout means. Private to the pool; not part of the public API.
 */
class Semaphore {
  private permits: number;
  private readonly waiters: Waiter[] = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  /** Take a permit, waiting up to `timeoutMs`. Resolves `false` on timeout. */
  acquire(timeoutMs: number): Promise<boolean> {
    if (this.permits > 0) {
      this.permits -= 1;
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      // On timeout the waiter leaves the queue, so a permit released later goes
      // to the next waiter instead of a caller that already gave up. The timer
      // is unref'd so a pending checkout never keeps the process alive.
      const timer = Number.isFinite(timeoutMs)
        ? setTimeout(() => {
            const index = this.waiters.indexOf(waiter);
            if (index !== -1) {
              this.waiters.splice(index, 1);
            }
            resolve(false);
          }, timeoutMs)
        : undefined;
      timer?.unref();
      const waiter: Waiter = {
        grant: () => {
          clearTimeout(timer);
          resolve(true);
        },
      };
      this.waiters.push(waiter);
    });
  }

  /** Return a permit, waking the oldest waiter if any. */
  release(): void {
    const next = this.waiters.shift();
    if (next) {
      next.grant();
    } else {
      this.permits += 1;
    }
  }
}

/**
 * Bounded checkout/return pool behind a `"pooled"`-scope resource. At most
 * `poolSize` instances are checked out at once; released instances go back to
 * an idle list for reuse until `maxLifetimeMs` evicts them. Implements the
 * cross-SDK pooled-resource semantics.
 */
export class ResourcePool {
  private readonly poolSize: number;
  private readonly poolMin: number;
  private readonly acquireTimeoutMs: number;
  private readonly maxLifetimeMs: number;
  private readonly semaphore: Semaphore;
  private readonly idle: IdleEntry[] = [];
  private activeCount = 0;
  private totalAcquisitions = 0;
  private totalTimeouts = 0;
  private shutDown = false;

  constructor(
    private readonly name: string,
    private readonly factory: () => Promise<unknown>,
    private readonly dispose: ((value: unknown) => void | Promise<void>) | undefined,
    options: PoolOptions,
    private readonly hooks: PoolHooks = {},
  ) {
    this.poolSize = options.poolSize ?? DEFAULT_POOL_SIZE;
    this.poolMin = options.poolMin ?? 0;
    this.acquireTimeoutMs = options.acquireTimeoutMs ?? DEFAULT_ACQUIRE_TIMEOUT_MS;
    this.maxLifetimeMs = options.maxLifetimeMs ?? Number.POSITIVE_INFINITY;
    this.semaphore = new Semaphore(this.poolSize);
  }

  /**
   * Top the idle list up to `poolMin` instances. Best-effort: logs and stops on
   * failure. Idempotent, so repeated worker leases don't overfill the pool.
   */
  async prewarm(): Promise<void> {
    while (this.idle.length + this.activeCount < this.poolMin) {
      try {
        const instance = await this.buildInstance();
        this.idle.push({ instance, createdAt: Date.now() });
      } catch (error) {
        log.warn(() => `failed to prewarm pooled resource "${this.name}"`, error);
        break;
      }
    }
  }

  /**
   * Check out an instance, waiting up to `acquireTimeoutMs` for capacity.
   * Reuses an idle instance when one is fresh enough, otherwise builds one.
   */
  async acquire(): Promise<unknown> {
    const granted = await this.semaphore.acquire(this.acquireTimeoutMs);
    if (!granted) {
      this.totalTimeouts += 1;
      throw new ResourceUnavailableError(
        `Resource "${this.name}" pool timed out after ${this.acquireTimeoutMs}ms`,
      );
    }

    // Reuse the oldest idle instance still within its lifetime; evict expired ones.
    let entry = this.idle.shift();
    while (entry) {
      if (Date.now() - entry.createdAt < this.maxLifetimeMs) {
        this.recordAcquired();
        return entry.instance;
      }
      await this.disposeInstance(entry.instance);
      entry = this.idle.shift();
    }

    // Nothing idle — build fresh. The permit is held across the build and only
    // returned on failure, so a rejecting factory never leaks capacity. `active`
    // is bumped only after the factory resolves, so it can never overcount.
    let instance: unknown;
    try {
      instance = await this.buildInstance();
    } catch (error) {
      this.semaphore.release();
      throw error;
    }
    this.recordAcquired();
    return instance;
  }

  /** Return an instance to the pool (or dispose it if the pool is shut down). */
  async release(instance: unknown): Promise<void> {
    this.activeCount -= 1;
    if (this.shutDown) {
      await this.disposeInstance(instance);
    } else {
      this.idle.push({ instance, createdAt: Date.now() });
    }
    this.semaphore.release();
  }

  /** Dispose every idle instance and route future returns straight to disposal. */
  async shutdown(): Promise<void> {
    this.shutDown = true;
    const entries = this.idle.splice(0);
    for (const entry of entries) {
      await this.disposeInstance(entry.instance);
    }
  }

  /** Point-in-time pool counters. */
  stats(): PoolStats {
    return {
      size: this.poolSize,
      active: this.activeCount,
      idle: this.idle.length,
      totalAcquisitions: this.totalAcquisitions,
      totalTimeouts: this.totalTimeouts,
    };
  }

  private async buildInstance(): Promise<unknown> {
    const instance = await this.factory();
    this.hooks.onCreated?.();
    return instance;
  }

  private recordAcquired(): void {
    this.totalAcquisitions += 1;
    this.activeCount += 1;
  }

  /** Dispose one instance; errors are logged, never thrown (best-effort cleanup). */
  private async disposeInstance(instance: unknown): Promise<void> {
    try {
      await this.dispose?.(instance);
    } catch (error) {
      log.debug(() => `disposing pooled resource "${this.name}" failed`, error);
    }
    this.hooks.onDisposed?.();
  }
}
