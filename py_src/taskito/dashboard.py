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
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib import resources
from typing import TYPE_CHECKING, Any
from urllib.parse import parse_qs, urlparse

if TYPE_CHECKING:
    from taskito.app import Queue


def _load_spa_html() -> str:
    """Load the dashboard SPA HTML from the bundled template file."""
    return (
        resources.files("taskito").joinpath("templates/dashboard.html").read_text(encoding="utf-8")
    )


_SPA_HTML: str | None = None


def _get_spa_html() -> str:
    global _SPA_HTML
    if _SPA_HTML is None:
        _SPA_HTML = _load_spa_html()
    return _SPA_HTML


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
            parsed = urlparse(self.path)
            path = parsed.path
            qs = parse_qs(parsed.query)

            if path == "/api/stats":
                self._json_response(queue.stats())
            elif path == "/api/jobs":
                self._handle_list_jobs(qs)
            elif path.startswith("/api/jobs/") and path.endswith("/errors"):
                job_id = path[len("/api/jobs/") : -len("/errors")]
                self._json_response(queue.job_errors(job_id))
            elif path.startswith("/api/jobs/"):
                job_id = path[len("/api/jobs/") :]
                job = queue.get_job(job_id)
                if job is None:
                    self._json_response({"error": "Job not found"}, status=404)
                else:
                    self._json_response(job.to_dict())
            elif path == "/api/dead-letters":
                limit = int(qs.get("limit", ["20"])[0])
                offset = int(qs.get("offset", ["0"])[0])
                self._json_response(queue.dead_letters(limit=limit, offset=offset))
            elif path == "/api/metrics":
                task = qs.get("task", [None])[0]
                since = int(qs.get("since", ["3600"])[0])
                self._json_response(queue.metrics(task_name=task, since=since))
            elif path.startswith("/api/jobs/") and path.endswith("/logs"):
                job_id = path[len("/api/jobs/") : -len("/logs")]
                self._json_response(queue.task_logs(job_id))
            elif path.startswith("/api/jobs/") and path.endswith("/replay-history"):
                job_id = path[len("/api/jobs/") : -len("/replay-history")]
                self._json_response(queue.replay_history(job_id))
            elif path == "/api/logs":
                task = qs.get("task", [None])[0]
                level = qs.get("level", [None])[0]
                since = int(qs.get("since", ["3600"])[0])
                limit = int(qs.get("limit", ["100"])[0])
                self._json_response(
                    queue.query_logs(task_name=task, level=level, since=since, limit=limit)
                )
            elif path == "/api/circuit-breakers":
                self._json_response(queue.circuit_breakers())
            elif path == "/api/workers":
                self._json_response(queue.workers())
            else:
                self._serve_spa()

        def do_POST(self) -> None:
            parsed = urlparse(self.path)
            path = parsed.path

            if path.startswith("/api/jobs/") and path.endswith("/cancel"):
                job_id = path[len("/api/jobs/") : -len("/cancel")]
                ok = queue.cancel_job(job_id)
                self._json_response({"cancelled": ok})
            elif path.startswith("/api/dead-letters/") and path.endswith("/retry"):
                dead_id = path[len("/api/dead-letters/") : -len("/retry")]
                new_id = queue.retry_dead(dead_id)
                self._json_response({"new_job_id": new_id})
            elif path == "/api/dead-letters/purge":
                count = queue.purge_dead(0)
                self._json_response({"purged": count})
            elif path.startswith("/api/jobs/") and path.endswith("/replay"):
                job_id = path[len("/api/jobs/") : -len("/replay")]
                result = queue.replay(job_id)
                self._json_response({"replay_job_id": result.id})
            else:
                self._json_response({"error": "Not found"}, status=404)

        def _handle_list_jobs(self, qs: dict) -> None:
            status = qs.get("status", [None])[0]
            q = qs.get("queue", [None])[0]
            task = qs.get("task", [None])[0]
            limit = int(qs.get("limit", ["20"])[0])
            offset = int(qs.get("offset", ["0"])[0])

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
