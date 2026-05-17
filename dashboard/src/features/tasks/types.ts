export interface TaskDefaults {
  max_retries: number;
  retry_backoff: number;
  timeout: number;
  priority: number;
  rate_limit: string | null;
  max_concurrent: number | null;
}

export interface TaskOverridePatch {
  rate_limit?: string | null;
  max_concurrent?: number | null;
  max_retries?: number | null;
  retry_backoff?: number | null;
  timeout?: number | null;
  priority?: number | null;
  paused?: boolean;
}

export interface TaskEntry {
  name: string;
  queue: string;
  defaults: TaskDefaults;
  override: TaskOverridePatch | null;
  effective: TaskDefaults;
  paused: boolean;
}

export interface QueueOverridePatch {
  rate_limit?: string | null;
  max_concurrent?: number | null;
  paused?: boolean;
}

export interface QueueEntry {
  name: string;
  defaults: Record<string, unknown>;
  override: QueueOverridePatch | null;
  effective: Record<string, unknown>;
  paused: boolean;
}
