"""Built-in web dashboard for taskito — zero extra dependencies.

Usage::

    taskito dashboard --app myapp:queue
    # → http://127.0.0.1:8080

Or programmatically::

    from taskito.dashboard import serve_dashboard
    serve_dashboard(queue, host="0.0.0.0", port=8080)

Serves the SPA at ``py_src/taskito/static/dashboard/`` (``index.html`` plus
hashed ``assets/`` produced by the Vite build) plus the JSON API under
``/api/*``. Requests for client-side routes fall back to ``index.html`` so
deep links work.
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib import resources
from typing import TYPE_CHECKING, Any
from urllib.parse import parse_qs, urlparse

logger = logging.getLogger("taskito.dashboard")

if TYPE_CHECKING:
    from taskito.app import Queue


class _BadRequest(Exception):
    """Raised by route handlers to signal a 400 response."""

    def __init__(self, message: str) -> None:
        self.message = message


class _NotFound(Exception):
    """Raised by route handlers to signal a 404 response."""

    def __init__(self, message: str) -> None:
        self.message = message


# ── Static asset delivery ────────────────────────────────────────────

_CONTENT_TYPES: dict[str, str] = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".webmanifest": "application/manifest+json",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".ttf": "font/ttf",
    ".txt": "text/plain; charset=utf-8",
    ".map": "application/json; charset=utf-8",
}

_STATIC_ROOT_REL = "static/dashboard"
_IMMUTABLE_PREFIX = "/assets/"


def _content_type_for(path: str) -> str:
    """Return the Content-Type for a request path by extension."""
    ext = os.path.splitext(path)[1].lower()
    return _CONTENT_TYPES.get(ext, "application/octet-stream")


def _resolve_static_node(base: Any, rel_path: str) -> Any | None:
    """Resolve a request path to a file node under ``base``.

    Rejects traversal attempts, null bytes, and backslash escapes. Returns
    ``None`` if the resolved node is not an existing regular file.

    ``base`` must support ``joinpath(name)``; the returned node must
    support ``is_file()`` and ``read_bytes()``. Works with both
    ``pathlib.Path`` and ``importlib.resources.abc.Traversable``.
    """
    clean = rel_path.lstrip("/")
    if not clean:
        return None
    parts = clean.split("/")
    for part in parts:
        if part in ("", ".", ".."):
            return None
        if "\x00" in part or "\\" in part:
            return None
    node = base
    for part in parts:
        node = node.joinpath(part)
    return node if node.is_file() else None


class StaticAssets:
    """Resolves dashboard SPA files under a single root.

    Treat instances as immutable — the root is fixed at construction.
    Pass one explicitly to :func:`serve_dashboard` or :func:`_make_handler`
    to override the default lookup; this is the seam tests use to swap in
    a tmp directory or force the missing-assets fallback without touching
    module-level state.
    """

    __slots__ = ("_root",)

    def __init__(self, root: Any | None) -> None:
        self._root = root

    @classmethod
    def from_package(cls) -> StaticAssets:
        """Locate assets bundled with the installed ``taskito`` package.

        Returns an instance whose root points at ``static/dashboard/`` if
        ``index.html`` is present in the wheel, otherwise an instance with
        ``available is False`` so the handler can render the missing-
        assets fallback.
        """
        try:
            candidate = resources.files("taskito").joinpath(_STATIC_ROOT_REL)
            if candidate.joinpath("index.html").is_file():
                return cls(candidate)
        except (ModuleNotFoundError, FileNotFoundError, AttributeError):
            pass
        return cls(None)

    @property
    def available(self) -> bool:
        return self._root is not None

    def resolve(self, rel_path: str) -> Any | None:
        """Return a file node for ``rel_path`` under the root, or ``None``."""
        if self._root is None:
            return None
        return _resolve_static_node(self._root, rel_path)

    def index(self) -> Any | None:
        """Return the ``index.html`` node, or ``None`` if assets aren't bundled."""
        if self._root is None:
            return None
        node = self._root.joinpath("index.html")
        return node if node.is_file() else None


_default_assets_lock = threading.Lock()
_default_assets: StaticAssets | None = None


def _get_default_assets() -> StaticAssets:
    """Lazily resolve and memoise the package-bundled ``StaticAssets``.

    Cheap to call repeatedly — the actual filesystem probe runs at most
    once per process. Tests don't touch this; they construct a
    ``StaticAssets`` directly and pass it to the handler.
    """
    global _default_assets
    if _default_assets is not None:
        return _default_assets
    with _default_assets_lock:
        if _default_assets is None:
            _default_assets = StaticAssets.from_package()
    return _default_assets


_MISSING_ASSETS_HTML = (
    "<!doctype html><html><head><meta charset='utf-8'>"
    "<title>Taskito — dashboard assets missing</title></head>"
    "<body style='font-family:system-ui;padding:2rem;max-width:640px'>"
    "<h1>Dashboard assets not bundled</h1>"
    "<p>This taskito install doesn't ship the compiled dashboard. "
    "If you're working from source, rebuild with:</p>"
    "<pre>pnpm --dir dashboard install &amp;&amp; pnpm --dir dashboard build</pre>"
    "<p>Then reinstall the package (<code>uv sync --reinstall-package taskito</code> "
    "or <code>pip install -e .</code>).</p>"
    "</body></html>"
)


def _parse_int_qs(qs: dict, key: str, default: int) -> int:
    """Parse an integer from query string, raising _BadRequest on invalid input."""
    try:
        val = int(qs.get(key, [str(default)])[0])
    except (ValueError, IndexError):
        raise _BadRequest(f"{key} must be an integer") from None
    if val < 0:
        raise _BadRequest(f"{key} must be non-negative")
    return val


# ── Route handlers ────────────────────────────────────────────────────
#
# Each handler takes (queue, qs) for GET or (queue, param) for parameterized
# routes and returns JSON-serializable data. Raise _BadRequest for 400s.


def _handle_list_jobs(queue: Queue, qs: dict) -> list[dict]:
    status = qs.get("status", [None])[0]
    q = qs.get("queue", [None])[0]
    task = qs.get("task", [None])[0]
    metadata_like = qs.get("metadata", [None])[0]
    error_like = qs.get("error", [None])[0]
    created_after = qs.get("created_after", [None])[0]
    created_before = qs.get("created_before", [None])[0]
    limit = _parse_int_qs(qs, "limit", 20)
    offset = _parse_int_qs(qs, "offset", 0)

    if any(x is not None for x in [metadata_like, error_like, created_after, created_before]):
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
        jobs = queue.list_jobs(status=status, queue=q, task_name=task, limit=limit, offset=offset)
    return [j.to_dict() for j in jobs]


def _handle_dead_letters(queue: Queue, qs: dict) -> list:
    limit = _parse_int_qs(qs, "limit", 20)
    offset = _parse_int_qs(qs, "offset", 0)
    return queue.dead_letters(limit=limit, offset=offset)


def _handle_metrics(queue: Queue, qs: dict) -> dict:
    task = qs.get("task", [None])[0]
    since = _parse_int_qs(qs, "since", 3600)
    return queue.metrics(task_name=task, since=since)


def _handle_metrics_timeseries(queue: Queue, qs: dict) -> list:
    task = qs.get("task", [None])[0]
    since = _parse_int_qs(qs, "since", 3600)
    bucket = _parse_int_qs(qs, "bucket", 60)
    return queue.metrics_timeseries(task_name=task, since=since, bucket=bucket)


def _handle_logs(queue: Queue, qs: dict) -> list:
    task = qs.get("task", [None])[0]
    level = qs.get("level", [None])[0]
    since = _parse_int_qs(qs, "since", 3600)
    limit = _parse_int_qs(qs, "limit", 100)
    return queue.query_logs(task_name=task, level=level, since=since, limit=limit)


def _handle_stats_queues(queue: Queue, qs: dict) -> dict:
    q_name = qs.get("queue", [None])[0]
    if q_name:
        return queue.stats_by_queue(q_name)
    return queue.stats_all_queues()


def _handle_get_job(queue: Queue, _qs: dict, job_id: str) -> dict:
    job = queue.get_job(job_id)
    if job is None:
        raise _NotFound("Job not found")
    return job.to_dict()


def _handle_replay_post(queue: Queue, job_id: str) -> dict:
    result = queue.replay(job_id)
    return {"replay_job_id": result.id}


def build_scaler_response(
    queue: Queue,
    queue_name: str | None = None,
    target_queue_depth: int = 10,
) -> dict[str, Any]:
    """Build KEDA-compatible scaler payload for a queue."""
    stats = queue.stats()
    depth = stats.get("pending", 0)
    running = stats.get("running", 0)

    worker_list = queue.workers()
    live_workers = len(worker_list)
    total_capacity = queue._workers

    response: dict[str, Any] = {
        "metricName": "taskito_queue_depth",
        "metricValue": depth,
        "isActive": depth > 0,
        "liveWorkers": live_workers,
        "totalCapacity": total_capacity,
        "targetQueueDepth": target_queue_depth,
    }

    if total_capacity > 0:
        response["workerUtilization"] = round(running / total_capacity, 3)

    if queue_name:
        q_stats = queue.stats_by_queue(queue_name)
        response["metricValue"] = q_stats.get("pending", 0)
        response["isActive"] = q_stats.get("pending", 0) > 0
        response["metricName"] = f"taskito_queue_depth_{queue_name}"

    try:
        all_q = queue.stats_all_queues()
        response["perQueue"] = {
            name: {"pending": s.get("pending", 0), "running": s.get("running", 0)}
            for name, s in all_q.items()
        }
    except Exception:
        logger.warning("Failed to collect per-queue stats for scaler", exc_info=True)

    return response


def serve_dashboard(
    queue: Queue,
    host: str = "127.0.0.1",
    port: int = 8080,
    *,
    static_assets: StaticAssets | None = None,
) -> None:
    """Start the dashboard HTTP server (blocking).

    Args:
        queue: The Queue instance to monitor.
        host: Bind address.
        port: Bind port.
        static_assets: Override the default SPA asset source. Mainly a
            test seam; downstream embedders can also use it to ship a
            customised dashboard bundle from a different location.
    """
    handler = _make_handler(queue, static_assets=static_assets)
    server = ThreadingHTTPServer((host, port), handler)
    print(f"taskito dashboard → http://{host}:{port}")
    print("Press Ctrl+C to stop")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


def _make_handler(queue: Queue, *, static_assets: StaticAssets | None = None) -> type:
    """Create a request handler class bound to the given queue.

    Args:
        queue: Queue inspected by the JSON routes.
        static_assets: SPA asset source. Defaults to the package-bundled
            assets resolved once per process; tests inject their own.
    """
    assets = static_assets if static_assets is not None else _get_default_assets()

    # ── Routing tables ────────────────────────────────────────────
    #
    # Exact-match routes: path → handler(queue, qs) → JSON data
    get_routes: dict[str, Any] = {
        "/api/stats": lambda q, qs: q.stats(),
        "/api/jobs": _handle_list_jobs,
        "/api/dead-letters": _handle_dead_letters,
        "/api/metrics": _handle_metrics,
        "/api/metrics/timeseries": _handle_metrics_timeseries,
        "/api/logs": _handle_logs,
        "/api/circuit-breakers": lambda q, qs: q.circuit_breakers(),
        "/api/workers": lambda q, qs: q.workers(),
        "/api/resources": lambda q, qs: q.resource_status(),
        "/api/proxy-stats": lambda q, qs: q.proxy_stats(),
        "/api/interception-stats": lambda q, qs: q.interception_stats(),
        "/api/queues/paused": lambda q, qs: q.paused_queues(),
        "/api/stats/queues": _handle_stats_queues,
        "/api/scaler": lambda q, qs: build_scaler_response(
            q, queue_name=qs.get("queue", [None])[0]
        ),
    }

    # Parameterized routes: regex → handler(queue, qs, captured_id) → JSON data
    # Order matters — more specific patterns first.
    get_param_routes = [
        (re.compile(r"^/api/jobs/([^/]+)/errors$"), lambda q, qs, jid: q.job_errors(jid)),
        (re.compile(r"^/api/jobs/([^/]+)/logs$"), lambda q, qs, jid: q.task_logs(jid)),
        (
            re.compile(r"^/api/jobs/([^/]+)/replay-history$"),
            lambda q, qs, jid: q.replay_history(jid),
        ),
        (re.compile(r"^/api/jobs/([^/]+)/dag$"), lambda q, qs, jid: q.job_dag(jid)),
        (re.compile(r"^/api/jobs/([^/]+)$"), _handle_get_job),
    ]

    # POST exact-match routes: path → handler(queue) → JSON data
    post_routes: dict[str, Any] = {
        "/api/dead-letters/purge": lambda q: {"purged": q.purge_dead(0)},
    }

    # POST parameterized routes: regex → handler(queue, captured_id) → JSON data
    post_param_routes = [
        (
            re.compile(r"^/api/jobs/([^/]+)/cancel$"),
            lambda q, jid: {"cancelled": q.cancel_job(jid)},
        ),
        (re.compile(r"^/api/jobs/([^/]+)/replay$"), _handle_replay_post),
        (
            re.compile(r"^/api/dead-letters/([^/]+)/retry$"),
            lambda q, did: {"new_job_id": q.retry_dead(did)},
        ),
        (re.compile(r"^/api/queues/([^/]+)/pause$"), lambda q, n: (q.pause(n), {"paused": n})[1]),
        (
            re.compile(r"^/api/queues/([^/]+)/resume$"),
            lambda q, n: (q.resume(n), {"resumed": n})[1],
        ),
    ]

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

            # Exact-match API routes
            handler = get_routes.get(path)
            if handler:
                try:
                    self._json_response(handler(queue, qs))
                except _BadRequest as e:
                    self._json_response({"error": e.message}, status=400)
                except _NotFound as e:
                    self._json_response({"error": e.message}, status=404)
                return

            # Parameterized API routes
            for pattern, param_handler in get_param_routes:
                m = pattern.match(path)
                if m:
                    try:
                        self._json_response(param_handler(queue, qs, m.group(1)))
                    except _BadRequest as e:
                        self._json_response({"error": e.message}, status=400)
                    except _NotFound as e:
                        self._json_response({"error": e.message}, status=404)
                    return

            # Non-JSON routes
            if path == "/health":
                from taskito.health import check_health

                self._json_response(check_health())
            elif path == "/readiness":
                from taskito.health import check_readiness

                self._json_response(check_readiness(queue))
            elif path == "/metrics":
                self._serve_prometheus_metrics()
            else:
                self._serve_spa(path)

        def do_POST(self) -> None:
            try:
                self._handle_post()
            except BrokenPipeError:
                pass
            except Exception:
                logger.exception("Error handling POST %s", self.path)
                self._json_response({"error": "Internal server error"}, status=500)

        def _handle_post(self) -> None:
            path = urlparse(self.path).path

            # Exact-match POST routes
            handler = post_routes.get(path)
            if handler:
                self._json_response(handler(queue))
                return

            # Parameterized POST routes
            for pattern, param_handler in post_param_routes:
                m = pattern.match(path)
                if m:
                    self._json_response(param_handler(queue, m.group(1)))
                    return

            self._json_response({"error": "Not found"}, status=404)

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

        def _serve_spa(self, req_path: str) -> None:
            """Serve a static asset from the SPA bundle, falling back to
            ``index.html`` so client-side routes deep-link correctly.
            """
            if not assets.available:
                self._serve_missing_assets()
                return

            node = assets.resolve(req_path)
            if node is not None:
                immutable = req_path.startswith(_IMMUTABLE_PREFIX)
                self._send_asset(node, _content_type_for(req_path), immutable=immutable)
                return

            if req_path.startswith(_IMMUTABLE_PREFIX):
                self._json_response({"error": "Not found"}, status=404)
                return

            index = assets.index()
            if index is None:
                self._serve_missing_assets()
                return
            self._send_asset(index, "text/html; charset=utf-8", immutable=False)

        def _send_asset(self, node: Any, content_type: str, *, immutable: bool) -> None:
            body: bytes = node.read_bytes()
            cache = "public, max-age=31536000, immutable" if immutable else "no-cache"
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", cache)
            self.end_headers()
            self.wfile.write(body)

        def _serve_missing_assets(self) -> None:
            body = _MISSING_ASSETS_HTML.encode()
            self.send_response(503)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format: str, *args: Any) -> None:
            # Suppress default access log noise
            pass

    return DashboardHandler
