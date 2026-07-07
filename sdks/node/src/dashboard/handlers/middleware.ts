// Middleware discovery + per-task enable/disable endpoints.

import type { Queue } from "../../index";
import { BadRequestError, NotFoundError } from "../errors";

export function listMiddleware(queue: Queue) {
  return queue.listMiddleware();
}

/** The middleware chain for a task with each entry's enabled state. */
export function getTaskMiddleware(queue: Queue, taskName: string) {
  const disabled = new Set(queue.getDisabledMiddlewareFor(taskName));
  const entries = queue.listMiddleware().map((mw) => ({
    name: mw.name,
    class_path: mw.class_path,
    disabled: disabled.has(String(mw.name)),
    effective: !disabled.has(String(mw.name)),
  }));
  return { task: taskName, middleware: entries };
}

export function putTaskMiddleware(
  queue: Queue,
  taskName: string,
  middlewareName: string,
  body: unknown,
) {
  const enabled = (body as { enabled?: unknown } | undefined)?.enabled;
  if (typeof enabled !== "boolean") {
    throw new BadRequestError('body must include {"enabled": bool}');
  }
  // Confirm the middleware exists so a typo can't write a no-op disable entry.
  const names = new Set(queue.listMiddleware().map((mw) => String(mw.name)));
  if (!names.has(middlewareName)) {
    throw new NotFoundError(
      `middleware '${middlewareName}' is not registered on task '${taskName}'`,
    );
  }
  const disabled = enabled
    ? queue.enableMiddlewareForTask(taskName, middlewareName)
    : queue.disableMiddlewareForTask(taskName, middlewareName);
  return { task: taskName, disabled };
}

/** Clear ALL disables for a task — every middleware fires again. */
export function deleteTaskMiddleware(queue: Queue, taskName: string) {
  return { cleared: queue.clearMiddlewareDisables(taskName) };
}
