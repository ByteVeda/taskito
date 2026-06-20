// Express integration for Taskito. Optional — import from `taskito/contrib/express`;
// requires `express` as a peer.
//
//   app.use("/tasks", taskitoRouter(queue));   // JSON API (enqueue + inspection)
//   app.use("/admin", taskitoDashboard(queue)); // the dashboard SPA + /api/*

import { fileURLToPath } from "node:url";
import express, { type RequestHandler, type Router } from "express";
import { createDashboardHandler } from "../dashboard";
import type { Queue } from "../queue";
import { createLogger } from "../utils";
import { buildRestRoutes, flattenQueryParams, type RestOptions, type RestRequest } from "./rest";

const log = createLogger("contrib:express");

/** Options for {@link taskitoRouter}. */
export type TaskitoRouterOptions = RestOptions;

/** Options for {@link taskitoDashboard}. */
export interface TaskitoDashboardOptions {
  /** Path to the built SPA assets (defaults to the package's bundled `static/dashboard`). */
  staticDir?: string;
}

/**
 * Build an Express {@link Router} exposing the Taskito REST API (enqueue, stats, job
 * lookup, cancel, dead-letters). JSON body parsing is mounted on the router itself.
 */
export function taskitoRouter(queue: Queue, options: TaskitoRouterOptions = {}): Router {
  const router = express.Router();
  router.use(express.json());

  for (const route of buildRestRoutes(options)) {
    const handler: RequestHandler = async (req, res) => {
      const request: RestRequest = {
        params: req.params as Record<string, string | undefined>,
        query: flattenQueryParams(req.query),
        body: req.body,
      };
      try {
        const result = await route.handle(queue, request);
        res.status(result.status).json(result.body);
      } catch (err) {
        // Log internally; don't leak internal error details to API callers.
        log.error(() => `${route.method} ${route.path} failed`, err);
        res.status(500).json({ error: "internal server error" });
      }
    };
    if (route.method === "GET") {
      router.get(route.path, handler);
    } else {
      router.post(route.path, handler);
    }
  }
  return router;
}

// Resolved relative to this entry's location in dist/contrib/ → package `static/dashboard`.
const STATIC_REL = ["..", "..", "static", "dashboard"].join("/");

function defaultStaticDir(): string {
  return fileURLToPath(new URL(STATIC_REL, import.meta.url));
}

/**
 * Build an Express middleware that serves the Taskito dashboard (SPA + `/api/*`). Mount
 * it under a path — Express strips the mount prefix, which the dashboard handler expects.
 */
export function taskitoDashboard(
  queue: Queue,
  options: TaskitoDashboardOptions = {},
): RequestHandler {
  const handler = createDashboardHandler(queue, options.staticDir ?? defaultStaticDir());
  return (req, res) => {
    handler(req, res);
  };
}
