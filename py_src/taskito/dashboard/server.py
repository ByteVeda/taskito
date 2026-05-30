"""HTTP server that wires routes to a Queue instance and serves the SPA.

The server enforces dashboard authentication when at least one user has been
registered with :class:`taskito.dashboard.auth.AuthStore`. Until the first
user is created, all API routes return ``503 setup_required`` so the SPA can
guide the operator through one-time setup. ``TASKITO_DASHBOARD_ADMIN_USER`` /
``TASKITO_DASHBOARD_ADMIN_PASSWORD`` environment variables bootstrap a user
idempotently on server start.
"""

from __future__ import annotations

import hmac
import json
import logging
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import TYPE_CHECKING, Any
from urllib.parse import parse_qs, unquote, urlparse

from taskito.dashboard.auth import (
    DEFAULT_SESSION_TTL_SECONDS,
    AuthStore,
    bootstrap_admin_from_env,
)
from taskito.dashboard.errors import _BadRequest, _NotFound
from taskito.dashboard.handlers.oauth import (
    OAuthRedirect,
    handle_providers,
)
from taskito.dashboard.handlers.oauth import (
    handle_callback as handle_oauth_callback,
)
from taskito.dashboard.handlers.oauth import (
    handle_start as handle_oauth_start,
)
from taskito.dashboard.request_context import (
    CSRF_COOKIE,
    SESSION_COOKIE,
    RequestContext,
    build_context,
)
from taskito.dashboard.routes import (
    AUTH_CONTEXT_GET_PATHS,
    AUTH_CONTEXT_POST_PATHS,
    DELETE_PARAM_ROUTES,
    GET_CTX_ROUTES,
    GET_PARAM2_ROUTES,
    GET_PARAM_ROUTES,
    GET_ROUTES,
    POST_BODY_ROUTES,
    POST_CTX_BODY_ROUTES,
    POST_CTX_ROUTES,
    POST_PARAM2_ROUTES,
    POST_PARAM_ROUTES,
    POST_ROUTES,
    PUT_PARAM2_ROUTES,
    PUT_PARAM_ROUTES,
    is_csrf_exempt,
    is_public_path,
    is_state_changing_method,
    requires_admin,
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
    from taskito.dashboard.oauth.flow import OAuthFlow


logger = logging.getLogger("taskito.dashboard")

# ASCII control characters (0x00-0x1F and 0x7F) plus tab are stripped before
# logging user-controlled paths. Tab survives so legitimate URLs containing
# ``%09`` decode-equivalents stay readable; CR/LF/null bytes are removed to
# defeat log-forging via crafted requests.
_LOG_UNSAFE_CHARS = {c: None for c in range(32) if c != 9}
_LOG_UNSAFE_CHARS[127] = None
_LOG_PATH_MAX = 256

# Hard cap on the request body we'll parse for PUT/POST requests.
_MAX_BODY_BYTES = 1 * 1024 * 1024  # 1 MiB


def _safe_path(path: str) -> str:
    """Return ``path`` with control characters stripped and length capped."""
    return path.translate(_LOG_UNSAFE_CHARS)[:_LOG_PATH_MAX]


def _session_cookies(session: Any, *, secure: bool = True) -> tuple[str, ...]:
    """Build the standard ``Set-Cookie`` headers for a freshly-created session.

    Used by both password login and OAuth callback so the cookie shape
    stays in lockstep across login methods. ``secure`` adds the ``Secure``
    attribute so the cookies are never sent over plain HTTP.
    """
    secure_attr = "; Secure" if secure else ""
    return (
        f"{SESSION_COOKIE}={session.token}; HttpOnly; SameSite=Strict; Path=/{secure_attr}; "
        f"Max-Age={DEFAULT_SESSION_TTL_SECONDS}",
        f"{CSRF_COOKIE}={session.csrf_token}; SameSite=Strict; Path=/{secure_attr}; "
        f"Max-Age={DEFAULT_SESSION_TTL_SECONDS}",
    )


def serve_dashboard(
    queue: Queue,
    host: str = "127.0.0.1",
    port: int = 8080,
    *,
    static_assets: StaticAssets | None = None,
    oauth_flow: OAuthFlow | None = None,
    secure_cookies: bool = True,
) -> None:
    """Start the dashboard HTTP server (blocking).

    Args:
        queue: The Queue instance to monitor.
        host: Bind address.
        port: Bind port.
        static_assets: Override the default SPA asset source. Mainly a
            test seam; downstream embedders can also use it to ship a
            customised dashboard bundle from a different location.
        oauth_flow: Configured :class:`OAuthFlow` to enable social login.
            When unset, OAuth endpoints respond 404 and the providers list
            is empty.
    """
    bootstrap_admin_from_env(queue)
    if oauth_flow is None:
        oauth_flow = _build_oauth_flow_from_env(queue)
    handler = _make_handler(
        queue,
        static_assets=static_assets,
        oauth_flow=oauth_flow,
        secure_cookies=secure_cookies,
    )
    server = ThreadingHTTPServer((host, port), handler)
    print(f"taskito dashboard → http://{host}:{port}")
    print("Press Ctrl+C to stop")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


def _build_oauth_flow_from_env(queue: Queue) -> OAuthFlow | None:
    """Build :class:`OAuthFlow` from environment variables, or ``None``.

    Failures in the env-var config are logged and treated as "OAuth not
    configured" — the dashboard still starts with password auth only.
    """
    try:
        from taskito.dashboard.oauth.config import from_env as oauth_from_env
        from taskito.dashboard.oauth.flow import OAuthFlow

        config = oauth_from_env()
        if config is None or not config.is_enabled:
            return None
        return OAuthFlow(queue, config)
    except Exception:
        logger.exception("OAuth env-var configuration is invalid; OAuth disabled")
        return None


def _make_handler(
    queue: Queue,
    *,
    static_assets: StaticAssets | None = None,
    oauth_flow: OAuthFlow | None = None,
    secure_cookies: bool = True,
) -> type:
    """Create a request handler class bound to the given queue."""
    assets = static_assets if static_assets is not None else _get_default_assets()
    cookie_secure_attr = "; Secure" if secure_cookies else ""

    class DashboardHandler(BaseHTTPRequestHandler):
        # ── Entry points ────────────────────────────────────────────

        def do_GET(self) -> None:
            try:
                self._handle_get()
            except BrokenPipeError:
                pass
            except Exception:
                logger.exception("Error handling GET %s", _safe_path(self.path))
                self._json_response({"error": "Internal server error"}, status=500)

        def do_POST(self) -> None:
            try:
                self._handle_post()
            except BrokenPipeError:
                pass
            except Exception:
                logger.exception("Error handling POST %s", _safe_path(self.path))
                self._json_response({"error": "Internal server error"}, status=500)

        def do_PUT(self) -> None:
            try:
                self._handle_put()
            except BrokenPipeError:
                pass
            except Exception:
                logger.exception("Error handling PUT %s", _safe_path(self.path))
                self._json_response({"error": "Internal server error"}, status=500)

        def do_DELETE(self) -> None:
            try:
                self._handle_delete()
            except BrokenPipeError:
                pass
            except Exception:
                logger.exception("Error handling DELETE %s", _safe_path(self.path))
                self._json_response({"error": "Internal server error"}, status=500)

        # ── Per-method dispatchers ──────────────────────────────────

        def _handle_get(self) -> None:
            parsed = urlparse(self.path)
            path = parsed.path
            qs = parse_qs(parsed.query)

            if not path.startswith("/api/") and path not in {"/health", "/readiness", "/metrics"}:
                self._serve_spa(path)
                return

            ctx, denied = self._authorize(path, "GET")
            if denied:
                return

            # ── OAuth flow paths (public, redirect-emitting) ────────
            if path == "/api/auth/providers":
                self._dispatch_with_handler(handle_providers, lambda h: h(queue, qs, oauth_flow))
                return
            if path.startswith("/api/auth/oauth/start/"):
                slot = unquote(path[len("/api/auth/oauth/start/") :])
                self._dispatch_oauth_redirect(handle_oauth_start, queue, qs, slot, oauth_flow)
                return
            if path.startswith("/api/auth/oauth/callback/"):
                slot = unquote(path[len("/api/auth/oauth/callback/") :])
                self._dispatch_oauth_redirect(handle_oauth_callback, queue, qs, slot, oauth_flow)
                return

            if path in AUTH_CONTEXT_GET_PATHS:
                self._dispatch_with_handler(GET_CTX_ROUTES.get(path), lambda h: h(queue, ctx))
                return

            handler = GET_ROUTES.get(path)
            if handler:
                self._dispatch_with_handler(handler, lambda h: h(queue, qs))
                return

            for pattern, param_handler in GET_PARAM_ROUTES:
                m = pattern.match(path)
                if m:
                    g1 = unquote(m.group(1))
                    self._dispatch_with_handler(param_handler, lambda h, g1=g1: h(queue, qs, g1))
                    return

            for pattern, param_handler in GET_PARAM2_ROUTES:
                m = pattern.match(path)
                if m:
                    g1, g2 = unquote(m.group(1)), unquote(m.group(2))
                    self._dispatch_with_handler(
                        param_handler,
                        lambda h, g1=g1, g2=g2: h(queue, qs, (g1, g2)),
                    )
                    return

            if path == "/health":
                self._json_response(check_health())
            elif path == "/readiness":
                if self._metrics_token_ok():
                    self._json_response(check_readiness(queue))
            elif path == "/metrics":
                if self._metrics_token_ok():
                    self._serve_prometheus_metrics()
            else:
                self._json_response({"error": "Not found"}, status=404)

        def _handle_post(self) -> None:
            path = urlparse(self.path).path
            ctx, denied = self._authorize(path, "POST")
            if denied:
                return

            if path == "/api/auth/login":
                body = self._read_json_body()
                if body is None:
                    return
                self._dispatch_with_handler(
                    POST_BODY_ROUTES[path],
                    lambda h: h(queue, body),
                    on_success=lambda resp: self._set_login_cookies(resp),
                )
                return

            if path == "/api/auth/setup":
                body = self._read_json_body()
                if body is None:
                    return
                self._dispatch_with_handler(POST_BODY_ROUTES[path], lambda h: h(queue, body))
                return

            if path in AUTH_CONTEXT_POST_PATHS:
                if path in POST_CTX_BODY_ROUTES:
                    body = self._read_json_body()
                    if body is None:
                        return
                    self._dispatch_with_handler(
                        POST_CTX_BODY_ROUTES[path],
                        lambda h: h(queue, body, ctx),
                    )
                else:
                    self._dispatch_with_handler(
                        POST_CTX_ROUTES[path],
                        lambda h: h(queue, ctx),
                        on_success=lambda _resp: (
                            self._clear_login_cookies() if path == "/api/auth/logout" else None
                        ),
                    )
                return

            handler = POST_ROUTES.get(path)
            if handler:
                self._dispatch_with_handler(handler, lambda h: h(queue))
                return

            body_handler = POST_BODY_ROUTES.get(path)
            if body_handler:
                body = self._read_json_body()
                if body is None:
                    return
                self._dispatch_with_handler(body_handler, lambda h, body=body: h(queue, body))
                return

            for pattern, param_handler in POST_PARAM_ROUTES:
                m = pattern.match(path)
                if m:
                    g1 = unquote(m.group(1))
                    self._dispatch_with_handler(param_handler, lambda h, g1=g1: h(queue, g1))
                    return

            for pattern, param_handler in POST_PARAM2_ROUTES:
                m = pattern.match(path)
                if m:
                    g1, g2 = unquote(m.group(1)), unquote(m.group(2))
                    self._dispatch_with_handler(
                        param_handler,
                        lambda h, g1=g1, g2=g2: h(queue, (g1, g2)),
                    )
                    return

            self._json_response({"error": "Not found"}, status=404)

        def _handle_put(self) -> None:
            path = urlparse(self.path).path
            _ctx, denied = self._authorize(path, "PUT")
            if denied:
                return

            for pattern, param_handler in PUT_PARAM_ROUTES:
                m = pattern.match(path)
                if m:
                    body = self._read_json_body()
                    if body is None:
                        return
                    g1 = unquote(m.group(1))
                    self._dispatch_with_handler(
                        param_handler, lambda h, g1=g1, body=body: h(queue, body, g1)
                    )
                    return
            for pattern, param_handler in PUT_PARAM2_ROUTES:
                m = pattern.match(path)
                if m:
                    body = self._read_json_body()
                    if body is None:
                        return
                    g1, g2 = unquote(m.group(1)), unquote(m.group(2))
                    self._dispatch_with_handler(
                        param_handler,
                        lambda h, g1=g1, g2=g2, body=body: h(queue, body, (g1, g2)),
                    )
                    return
            self._json_response({"error": "Not found"}, status=404)

        def _handle_delete(self) -> None:
            path = urlparse(self.path).path
            _ctx, denied = self._authorize(path, "DELETE")
            if denied:
                return

            for pattern, param_handler in DELETE_PARAM_ROUTES:
                m = pattern.match(path)
                if m:
                    g1 = unquote(m.group(1))
                    self._dispatch_with_handler(param_handler, lambda h, g1=g1: h(queue, g1))
                    return
            self._json_response({"error": "Not found"}, status=404)

        # ── Auth gating ─────────────────────────────────────────────

        def _authorize(self, path: str, method: str) -> tuple[RequestContext, bool]:
            """Return ``(ctx, denied)``. When ``denied`` is true a response
            has already been written and the caller must return."""
            ctx = self._build_context()

            # Setup-required short-circuit: before the first user is created
            # every API endpoint (except the public ones) returns 503 so the
            # SPA can show the setup page.
            if (
                path.startswith("/api/")
                and not is_public_path(path)
                and AuthStore(queue).count_users() == 0
            ):
                self._json_response({"error": "setup_required"}, status=503)
                return ctx, True

            if is_public_path(path) or not path.startswith("/api/"):
                # CSRF still applies to public state-changing routes that are
                # NOT exempt — but login/setup are the only public POSTs and
                # they're exempt.
                return ctx, False

            if not ctx.is_authenticated:
                self._json_response({"error": "not_authenticated"}, status=401)
                return ctx, True

            if (
                is_state_changing_method(method)
                and not is_csrf_exempt(path)
                and not ctx.csrf_valid()
            ):
                self._json_response({"error": "csrf_failed"}, status=403)
                return ctx, True

            # Authorization: mutating routes require the admin role. Viewers
            # retain read access and their own auth self-service endpoints.
            if requires_admin(path, method) and ctx.role != "admin":
                self._json_response({"error": "forbidden"}, status=403)
                return ctx, True

            return ctx, False

        def _build_context(self) -> RequestContext:
            cookies_header = self.headers.get("Cookie")
            session = None
            if cookies_header:
                from taskito.dashboard.request_context import parse_cookies

                cookies = parse_cookies(cookies_header)
                token = cookies.get(SESSION_COOKIE)
                if token:
                    session = AuthStore(queue).get_session(token)
            return build_context(self.headers, session)

        # ── Cookie management ───────────────────────────────────────

        def _set_login_cookies(self, response: dict[str, Any]) -> None:
            """Set HttpOnly session cookie and CSRF cookie on a login response."""
            session = response.get("session") or {}
            token = session.get("token")
            csrf = session.get("csrf_token")
            if not token or not csrf:
                return
            # 24-hour Max-Age matches the session TTL.
            self._extra_set_cookies = [
                f"{SESSION_COOKIE}={token}; HttpOnly; SameSite=Strict; "
                f"Path=/{cookie_secure_attr}; Max-Age={DEFAULT_SESSION_TTL_SECONDS}",
                f"{CSRF_COOKIE}={csrf}; SameSite=Strict; "
                f"Path=/{cookie_secure_attr}; Max-Age={DEFAULT_SESSION_TTL_SECONDS}",
            ]
            # Don't leak the raw token in the JSON body — the cookie holds it.
            response["session"] = {k: v for k, v in session.items() if k != "token"}

        def _clear_login_cookies(self) -> None:
            self._extra_set_cookies = [
                f"{SESSION_COOKIE}=; HttpOnly; SameSite=Strict; "
                f"Path=/{cookie_secure_attr}; Max-Age=0",
                f"{CSRF_COOKIE}=; SameSite=Strict; Path=/{cookie_secure_attr}; Max-Age=0",
            ]

        # ── Dispatch helper ─────────────────────────────────────────

        def _dispatch_with_handler(
            self,
            handler: Any,
            invoke: Any,
            *,
            on_success: Any | None = None,
        ) -> None:
            if handler is None:
                self._json_response({"error": "Not found"}, status=404)
                return
            try:
                result = invoke(handler)
            except _BadRequest as e:
                self._json_response({"error": e.message}, status=400)
                return
            except _NotFound as e:
                self._json_response({"error": e.message}, status=404)
                return
            if on_success is not None:
                on_success(result)
            self._json_response(result)

        def _dispatch_oauth_redirect(
            self,
            handler: Any,
            queue: Any,
            qs: dict[str, list[str]],
            slot: str,
            flow: OAuthFlow | None,
        ) -> None:
            try:
                redirect: OAuthRedirect = handler(queue, qs, slot, flow)
            except _BadRequest as e:
                self._json_response({"error": e.message}, status=400)
                return
            except _NotFound as e:
                self._json_response({"error": e.message}, status=404)
                return
            cookies: list[str] = []
            if redirect.session is not None:
                cookies = list(_session_cookies(redirect.session, secure=secure_cookies))
            self.send_response(redirect.status)
            self.send_header("Location", redirect.url)
            self.send_header("Content-Length", "0")
            self.send_header("Cache-Control", "no-store")
            for cookie in cookies:
                self.send_header("Set-Cookie", cookie)
            self.end_headers()

        # ── Body / response helpers ─────────────────────────────────

        def _read_json_body(self) -> Any | None:
            """Read and parse the request body as JSON. Returns ``None`` after
            writing the appropriate error response (400/413)."""
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
            # Cookies are first-party only — no wildcard CORS. The SPA is
            # served from the same origin as the API.
            for cookie in getattr(self, "_extra_set_cookies", ()):
                self.send_header("Set-Cookie", cookie)
            self.end_headers()
            self.wfile.write(body)

        def _metrics_token_ok(self) -> bool:
            """Gate ``/metrics`` and ``/readiness`` behind an optional bearer token.

            When ``TASKITO_DASHBOARD_METRICS_TOKEN`` is unset the endpoints stay
            public (probe-friendly default). When set, a matching
            ``Authorization: Bearer <token>`` header is required. Writes a 401
            and returns ``False`` when the check fails.
            """
            token = os.environ.get("TASKITO_DASHBOARD_METRICS_TOKEN")
            if not token:
                return True
            header = self.headers.get("Authorization", "")
            if hmac.compare_digest(header, f"Bearer {token}"):
                return True
            self._json_response({"error": "not_authenticated"}, status=401)
            return False

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


__all__ = ["_make_handler", "serve_dashboard"]
