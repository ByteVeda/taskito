"""Built-in web dashboard for taskito — zero extra dependencies.

Usage::

    taskito dashboard --app myapp:queue
    # → http://127.0.0.1:8080

Or programmatically::

    from taskito.dashboard import serve_dashboard
    serve_dashboard(queue, host="0.0.0.0", port=8080)
"""

from __future__ import annotations

import json
import logging
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib import resources
from typing import TYPE_CHECKING, Any
from urllib.parse import parse_qs, urlparse

logger = logging.getLogger("taskito.dashboard")

if TYPE_CHECKING:
    from taskito.app import Queue


def _load_spa_html() -> str:
    """Load the dashboard SPA HTML from the bundled template file."""
    return (
        resources.files("taskito").joinpath("templates/dashboard.html").read_text(encoding="utf-8")
    )


_SPA_HTML: str | None = None
_spa_lock = threading.Lock()


def _get_spa_html() -> str:
    global _SPA_HTML
    if _SPA_HTML is None:
        with _spa_lock:
            if _SPA_HTML is None:
                _SPA_HTML = _load_spa_html()
    return _SPA_HTML


def _extract_path_segment(path: str, prefix: str, suffix: str = "") -> str:
    """Extract the segment between prefix and suffix from a URL path."""
    if suffix:
        return path[len(prefix) : -len(suffix)]
    return path[len(prefix) :]


def _parse_int_qs(qs: dict, key: str, default: int) -> int | None:
    """Parse an integer from query string, returning None on invalid input."""
    try:
        val = int(qs.get(key, [str(default)])[0])
        return val if val >= 0 else None
    except (ValueError, IndexError):
        return None


def serve_dashboard(
    queue: Queue,
    host: str = "127.0.0.1",
    port: int = 8080,
) -> None:
    """Start the dashboard HTTP server (blocking).

    Args:
        queue: The Queue instance to monitor.
        host: Bind address.
        port: Bind port.
    """

    handler = _make_handler(queue)
    server = ThreadingHTTPServer((host, port), handler)
    print(f"taskito dashboard → http://{host}:{port}")
    print("Press Ctrl+C to stop")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


def _make_handler(queue: Queue) -> type:
    """Create a request handler class bound to the given queue."""

    class DashboardHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            try:
                self._handle_get()
            except BrokenPipeError:
                pass
            except Exception:
                logger.exception("Error handling GET %s", self.path)
                self._json_response({"error": "Internal server error"}, status=500)

        def _handle_get(self) -> None:
            parsed = urlparse(self.path)
            path = parsed.path
            qs = parse_qs(parsed.query)

            if path == "/api/stats":
                self._json_response(queue.stats())
            elif path == "/api/jobs":
                self._handle_list_jobs(qs)
            elif path.startswith("/api/jobs/") and path.endswith("/errors"):
                job_id = _extract_path_segment(path, "/api/jobs/", "/errors")
                self._json_response(queue.job_errors(job_id))
            elif path.startswith("/api/jobs/") and path.endswith("/logs"):
                job_id = _extract_path_segment(path, "/api/jobs/", "/logs")
                self._json_response(queue.task_logs(job_id))
            elif path.startswith("/api/jobs/") and path.endswith("/replay-history"):
                job_id = _extract_path_segment(path, "/api/jobs/", "/replay-history")
                self._json_response(queue.replay_history(job_id))
            elif path.startswith("/api/jobs/"):
                job_id = _extract_path_segment(path, "/api/jobs/")
                job = queue.get_job(job_id)
                if job is None:
                    self._json_response({"error": "Job not found"}, status=404)
                else:
                    self._json_response(job.to_dict())
            elif path == "/api/dead-letters":
                limit = _parse_int_qs(qs, "limit", 20)
                offset = _parse_int_qs(qs, "offset", 0)
                if limit is None or offset is None:
                    self._json_response({"error": "limit and offset must be integers"}, status=400)
                    return
                self._json_response(queue.dead_letters(limit=limit, offset=offset))
            elif path == "/api/metrics":
                task = qs.get("task", [None])[0]
                since = _parse_int_qs(qs, "since", 3600)
                if since is None:
                    self._json_response({"error": "since must be an integer"}, status=400)
                    return
                self._json_response(queue.metrics(task_name=task, since=since))
            elif path == "/api/logs":
                task = qs.get("task", [None])[0]
                level = qs.get("level", [None])[0]
                since = _parse_int_qs(qs, "since", 3600)
                limit = _parse_int_qs(qs, "limit", 100)
                if since is None or limit is None:
                    self._json_response({"error": "since and limit must be integers"}, status=400)
                    return
                self._json_response(
                    queue.query_logs(task_name=task, level=level, since=since, limit=limit)
                )
            elif path == "/api/circuit-breakers":
                self._json_response(queue.circuit_breakers())
            elif path == "/api/workers":
                self._json_response(queue.workers())
            elif path == "/api/queues/paused":
                self._json_response(queue.paused_queues())
            elif path == "/metrics":
                self._serve_prometheus_metrics()
            elif path == "/health":
                from taskito.health import check_health

                self._json_response(check_health())
            elif path == "/readiness":
                from taskito.health import check_readiness

                self._json_response(check_readiness(queue))
            elif path == "/api/stats/queues":
                q_name = qs.get("queue", [None])[0]
                if q_name:
                    self._json_response(queue.stats_by_queue(q_name))
                else:
                    self._json_response(queue.stats_all_queues())
            elif path.startswith("/api/jobs/") and path.endswith("/dag"):
                job_id = _extract_path_segment(path, "/api/jobs/", "/dag")
                self._json_response(queue.job_dag(job_id))
            elif path == "/api/metrics/timeseries":
                task = qs.get("task", [None])[0]
                since = _parse_int_qs(qs, "since", 3600)
                bucket = _parse_int_qs(qs, "bucket", 60)
                if since is None or bucket is None:
                    self._json_response({"error": "since and bucket must be integers"}, status=400)
                    return
                self._json_response(
                    queue.metrics_timeseries(task_name=task, since=since, bucket=bucket)
                )
            elif path == "/api/scaler":
                stats = queue.stats()
                depth = stats.get("pending", 0)
                q_name = qs.get("queue", [None])[0]
                response: dict[str, Any] = {
                    "metricName": "taskito_queue_depth",
                    "metricValue": depth,
                    "isActive": depth > 0,
                }
                # Per-queue stats
                running = stats.get("running", 0)
                total_workers = queue._workers
                if total_workers > 0:
                    response["workerUtilization"] = round(running / total_workers, 3)
                if q_name:
                    q_stats = queue.stats_by_queue(q_name)
                    response["metricValue"] = q_stats.get("pending", 0)
                    response["isActive"] = q_stats.get("pending", 0) > 0
                try:
                    all_q = queue.stats_all_queues()
                    response["perQueue"] = {
                        name: {"pending": s.get("pending", 0), "running": s.get("running", 0)}
                        for name, s in all_q.items()
                    }
                except Exception:
                    pass
                self._json_response(response)
            else:
                self._serve_spa()

        def do_POST(self) -> None:
            try:
                self._handle_post()
            except BrokenPipeError:
                pass
            except Exception:
                logger.exception("Error handling POST %s", self.path)
                self._json_response({"error": "Internal server error"}, status=500)

        def _handle_post(self) -> None:
            parsed = urlparse(self.path)
            path = parsed.path

            if path.startswith("/api/jobs/") and path.endswith("/cancel"):
                job_id = _extract_path_segment(path, "/api/jobs/", "/cancel")
                ok = queue.cancel_job(job_id)
                self._json_response({"cancelled": ok})
            elif path.startswith("/api/dead-letters/") and path.endswith("/retry"):
                dead_id = _extract_path_segment(path, "/api/dead-letters/", "/retry")
                new_id = queue.retry_dead(dead_id)
                self._json_response({"new_job_id": new_id})
            elif path == "/api/dead-letters/purge":
                count = queue.purge_dead(0)
                self._json_response({"purged": count})
            elif path.startswith("/api/jobs/") and path.endswith("/replay"):
                job_id = _extract_path_segment(path, "/api/jobs/", "/replay")
                result = queue.replay(job_id)
                self._json_response({"replay_job_id": result.id})
            elif path.startswith("/api/queues/") and path.endswith("/pause"):
                name = _extract_path_segment(path, "/api/queues/", "/pause")
                queue.pause(name)
                self._json_response({"paused": name})
            elif path.startswith("/api/queues/") and path.endswith("/resume"):
                name = _extract_path_segment(path, "/api/queues/", "/resume")
                queue.resume(name)
                self._json_response({"resumed": name})
            else:
                self._json_response({"error": "Not found"}, status=404)

        def _handle_list_jobs(self, qs: dict) -> None:
            status = qs.get("status", [None])[0]
            q = qs.get("queue", [None])[0]
            task = qs.get("task", [None])[0]
            metadata_like = qs.get("metadata", [None])[0]
            error_like = qs.get("error", [None])[0]
            created_after = qs.get("created_after", [None])[0]
            created_before = qs.get("created_before", [None])[0]
            limit = _parse_int_qs(qs, "limit", 20)
            offset = _parse_int_qs(qs, "offset", 0)
            if limit is None or offset is None:
                self._json_response({"error": "limit and offset must be integers"}, status=400)
                return

            # Use filtered listing if any advanced filters are provided
            if any(
                x is not None for x in [metadata_like, error_like, created_after, created_before]
            ):
                ca = int(created_after) if created_after else None
                cb = int(created_before) if created_before else None
                jobs = queue.list_jobs_filtered(
                    status=status,
                    queue=q,
                    task_name=task,
                    metadata_like=metadata_like,
                    error_like=error_like,
                    created_after=ca,
                    created_before=cb,
                    limit=limit,
                    offset=offset,
                )
            else:
                jobs = queue.list_jobs(
                    status=status,
                    queue=q,
                    task_name=task,
                    limit=limit,
                    offset=offset,
                )
            self._json_response([j.to_dict() for j in jobs])

        def _json_response(self, data: Any, status: int = 200) -> None:
            body = json.dumps(data, default=str).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)

        def _serve_prometheus_metrics(self) -> None:
            try:
                from prometheus_client import generate_latest

                body = generate_latest()
                self.send_response(200)
                self.send_header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except ImportError:
                self._json_response({"error": "prometheus-client not installed"}, status=501)

        def _serve_spa(self) -> None:
            body = _get_spa_html().encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format: str, *args: Any) -> None:
            # Suppress default access log noise
            pass

    return DashboardHandler
