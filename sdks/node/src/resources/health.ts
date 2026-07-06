import { createLogger } from "../utils";
import type { ResourceRuntime } from "./runtime";
import type { ResourceDefinition } from "./types";

const log = createLogger("resources");

/** How often the daemon wakes to see whether any resource's check is due. */
const TICK_MS = 500;

/** Fallback for {@link ResourceDefinition.maxRecreationAttempts}. */
const DEFAULT_MAX_RECREATION_ATTEMPTS = 3;

/**
 * Periodically checks worker-resource health and recreates failing instances.
 *
 * One unref'd timer wakes every {@link TICK_MS}; each resource with a positive
 * `healthCheckIntervalMs` is checked independently on its own schedule. A
 * failed (or throwing) check triggers recreation; when recreation also fails
 * and the failure budget is spent, the resource is marked permanently
 * unhealthy and never rechecked.
 */
export class HealthChecker {
  private timer: ReturnType<typeof setInterval> | undefined;
  /** Guards against overlapping ticks while a check/recreate is still running. */
  private running = false;
  private readonly nextDue = new Map<string, number>();
  private readonly failCount = new Map<string, number>();

  constructor(private readonly runtime: ResourceRuntime) {}

  /** Start the daemon. No-op unless some resource asked for health checks. */
  start(): void {
    if (this.timer) {
      return;
    }
    const checked = this.runtime.healthChecked();
    if (checked.size === 0) {
      return;
    }
    const now = Date.now();
    for (const [name, def] of checked) {
      this.nextDue.set(name, now + (def.healthCheckIntervalMs ?? 0));
      this.failCount.set(name, 0);
    }
    // The tick never rejects (see below), so the timer can't leak an
    // unhandled rejection; unref keeps it from pinning the process open.
    this.timer = setInterval(() => void this.tick(checked), TICK_MS);
    this.timer.unref();
  }

  /** Stop the daemon. Safe to call repeatedly or without a prior start. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** One wake-up: run every due check. Catches everything — timers must survive. */
  private async tick(checked: ReadonlyMap<string, ResourceDefinition>): Promise<void> {
    if (this.running) {
      return; // the previous tick's async work is still in flight
    }
    this.running = true;
    try {
      for (const [name, def] of checked) {
        if (Date.now() < (this.nextDue.get(name) ?? 0) || this.runtime.isUnhealthy(name)) {
          continue;
        }
        await this.checkAndRepair(name, def);
        this.nextDue.set(name, Date.now() + (def.healthCheckIntervalMs ?? 0));
      }
    } catch (error) {
      log.warn(() => "health-check tick failed", error);
    } finally {
      this.running = false;
    }
  }

  /** Check one resource; on failure recreate it, exhausting into unhealthy. */
  private async checkAndRepair(name: string, def: ResourceDefinition): Promise<void> {
    if (await this.checkOne(name, def)) {
      this.failCount.set(name, 0);
      return;
    }
    const failures = (this.failCount.get(name) ?? 0) + 1;
    this.failCount.set(name, failures);
    const maxAttempts = def.maxRecreationAttempts ?? DEFAULT_MAX_RECREATION_ATTEMPTS;
    log.warn(`resource "${name}" health check failed (${failures}/${maxAttempts})`);
    if (await this.runtime.recreate(name)) {
      this.failCount.set(name, 0); // a fresh instance starts with a clean slate
    } else if (failures >= maxAttempts) {
      this.runtime.markUnhealthy(name);
    }
  }

  /** Run a single health check. A throwing check counts as unhealthy. */
  private async checkOne(name: string, def: ResourceDefinition): Promise<boolean> {
    const { healthCheck } = def;
    if (!healthCheck) {
      return true;
    }
    const built = this.runtime.builtWorkerInstance(name);
    if (!built) {
      return false; // nothing built yet — recreation will build it
    }
    try {
      return Boolean(await healthCheck(await built));
    } catch (error) {
      log.warn(() => `health check for resource "${name}" threw`, error);
      return false;
    }
  }
}
