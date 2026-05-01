"""HTTP server that wires routes to a Queue instance and serves the SPA."""

from __future__ import annotations

import json
import logging
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import TYPE_CHECKING, Any
from urllib.parse import parse_qs, urlparse

from taskito.dashboard.errors import _BadRequest, _NotFound
from taskito.dashboard.routes import (
    DELETE_PARAM_ROUTES,
    GET_PARAM_ROUTES,
    GET_ROUTES,
    POST_PARAM_ROUTES,
    POST_ROUTES,
    PUT_PARAM_ROUTES,
)
from taskito.dashboard.static import (
    IMMUTABLE_PREFIX,
    MISSING_ASSETS_HTML,
    StaticAssets,
    _content_type_for,
    _get_default_assets,
)
from taskito.health import check_health, check_readiness

if TYPE_CHECKING:
    from taskito.app import Queue


logger = logging.getLogger("taskito.dashboard")

# ASCII control characters (0x00-0x1F and 0x7F) plus tab are stripped before
# logging user-controlled paths. Tab survives so legitimate URLs containing
# ``%09`` decode-equivalents stay readable; CR/LF/null bytes are removed to
# defeat log-forging via crafted requests.
_LOG_UNSAFE_CHARS = {c: None for c in range(32) if c != 9}
_LOG_UNSAFE_CHARS[127] = None
_LOG_PATH_MAX = 256

# Hard cap on the request body we'll parse for PUT requests. Settings and
# other config writes are tiny; anything larger is almost certainly an
# attacker probing for memory exhaustion.
_MAX_BODY_BYTES = 1 * 1024 * 1024  # 1 MiB


def _safe_path(path: str) -> str:
    """Return ``path`` with control characters stripped and length capped.

    Used when including the request URI in log messages — never trust
    user-controlled strings to be free of CR/LF/null bytes that would let
    an attacker forge fake log lines.
    """
    return path.translate(_LOG_UNSAFE_CHARS)[:_LOG_PATH_MAX]


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

    class DashboardHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            try:
                self._handle_get()
            except BrokenPipeError:
                pass
            except Exception:
                logger.exception("Error handling GET %s", _safe_path(self.path))
                self._json_response({"error": "Internal server error"}, status=500)

        def _handle_get(self) -> None:
            parsed = urlparse(self.path)
            path = parsed.path
            qs = parse_qs(parsed.query)

            # Exact-match API routes
            handler = GET_ROUTES.get(path)
            if handler:
                try:
                    self._json_response(handler(queue, qs))
                except _BadRequest as e:
                    self._json_response({"error": e.message}, status=400)
                except _NotFound as e:
                    self._json_response({"error": e.message}, status=404)
                return

            # Parameterized API routes
            for pattern, param_handler in GET_PARAM_ROUTES:
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
                self._json_response(check_health())
            elif path == "/readiness":
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
                logger.exception("Error handling POST %s", _safe_path(self.path))
                self._json_response({"error": "Internal server error"}, status=500)

        def _handle_post(self) -> None:
            path = urlparse(self.path).path

            # Exact-match POST routes
            handler = POST_ROUTES.get(path)
            if handler:
                self._json_response(handler(queue))
                return

            # Parameterized POST routes
            for pattern, param_handler in POST_PARAM_ROUTES:
                m = pattern.match(path)
                if m:
                    self._json_response(param_handler(queue, m.group(1)))
                    return

            self._json_response({"error": "Not found"}, status=404)

        def do_PUT(self) -> None:
            try:
                self._handle_put()
            except BrokenPipeError:
                pass
            except Exception:
                logger.exception("Error handling PUT %s", _safe_path(self.path))
                self._json_response({"error": "Internal server error"}, status=500)

        def _handle_put(self) -> None:
            path = urlparse(self.path).path
            for pattern, param_handler in PUT_PARAM_ROUTES:
                m = pattern.match(path)
                if m:
                    body = self._read_json_body()
                    if body is None:
                        return
                    try:
                        self._json_response(param_handler(queue, body, m.group(1)))
                    except _BadRequest as e:
                        self._json_response({"error": e.message}, status=400)
                    except _NotFound as e:
                        self._json_response({"error": e.message}, status=404)
                    return
            self._json_response({"error": "Not found"}, status=404)

        def do_DELETE(self) -> None:
            try:
                self._handle_delete()
            except BrokenPipeError:
                pass
            except Exception:
                logger.exception("Error handling DELETE %s", _safe_path(self.path))
                self._json_response({"error": "Internal server error"}, status=500)

        def _handle_delete(self) -> None:
            path = urlparse(self.path).path
            for pattern, param_handler in DELETE_PARAM_ROUTES:
                m = pattern.match(path)
                if m:
                    try:
                        self._json_response(param_handler(queue, m.group(1)))
                    except _BadRequest as e:
                        self._json_response({"error": e.message}, status=400)
                    except _NotFound as e:
                        self._json_response({"error": e.message}, status=404)
                    return
            self._json_response({"error": "Not found"}, status=404)

        def _read_json_body(self) -> Any | None:
            """Read and parse the request body as JSON.

            Returns ``None`` after writing the appropriate error response
            (400/413) when the body is missing, malformed, or oversized.
            """
            length_header = self.headers.get("Content-Length")
            try:
                length = int(length_header) if length_header is not None else 0
            except ValueError:
                self._json_response({"error": "invalid Content-Length"}, status=400)
                return None
            if length < 0:
                self._json_response({"error": "invalid Content-Length"}, status=400)
                return None
            if length > _MAX_BODY_BYTES:
                self._json_response({"error": "request body too large"}, status=413)
                return None
            raw = self.rfile.read(length) if length else b""
            if not raw:
                return {}
            try:
                return json.loads(raw)
            except json.JSONDecodeError as e:
                self._json_response({"error": f"invalid JSON: {e.msg}"}, status=400)
                return None

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
                immutable = req_path.startswith(IMMUTABLE_PREFIX)
                self._send_asset(node, _content_type_for(req_path), immutable=immutable)
                return

            if req_path.startswith(IMMUTABLE_PREFIX):
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
            body = MISSING_ASSETS_HTML.encode()
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
