import { createServer, type Server, type ServerResponse } from "node:http";
import type { Queue } from "../queue";
import { createLogger } from "../utils";

const log = createLogger("scaler");

/** Options for {@link serveScaler}. */
export interface ScalerOptions {
  /** Port to listen on (default 9091). */
  port?: number;
  /** Host to bind (default `0.0.0.0`, so KEDA in-cluster can reach it). */
  host?: string;
  /** Target queue depth per replica returned to KEDA (default 10). */
  targetQueueDepth?: number;
  /** Restrict the metric to one queue (default: all queues). Overridable per request via `?queue=`. */
  queue?: string;
}

/**
 * Start the KEDA scaler server over `queue`. KEDA's `metrics-api` scaler polls
 * `GET /api/scaler` for the current queue depth and target, then scales the
 * worker deployment toward `ceil(metricValue / targetValue)` replicas.
 *
 * Endpoints:
 * - `GET /api/scaler[?queue=<name>]` → `{ metricValue, targetValue, queueName }`
 * - `GET /health` → `{ status: "ok" }`
 *
 * Returns the listening server; call `.close()` to stop it.
 */
export function serveScaler(queue: Queue, options: ScalerOptions = {}): Server {
  const targetValue = options.targetQueueDepth ?? 10;
  const defaultQueue = options.queue;

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/health") {
      sendJson(res, 200, { status: "ok" });
      return;
    }
    if (url.pathname === "/api/scaler" && req.method === "GET") {
      const queueName = url.searchParams.get("queue") ?? defaultQueue;
      try {
        const metricValue = queueName
          ? queue.statsByQueue(queueName).pending
          : queue.stats().pending;
        sendJson(res, 200, { metricValue, targetValue, queueName: queueName ?? "*" });
      } catch (error) {
        log.error(() => "scaler metric read failed", error);
        sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }
    sendJson(res, 404, { error: "not found" });
  });

  server.listen(options.port ?? 9091, options.host ?? "0.0.0.0");
  return server;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}
