"""Built-in web dashboard for taskito — zero extra dependencies.

Usage::

    taskito dashboard --app myapp:queue
    # → http://127.0.0.1:8080

Or programmatically::

    from taskito.dashboard import serve_dashboard
    serve_dashboard(queue, host="0.0.0.0", port=8080)

Serves the SPA at ``sdks/python/taskito/static/dashboard/`` (``index.html`` plus
hashed ``assets/`` produced by the Vite build) plus the JSON API under
``/api/*``. Requests for client-side routes fall back to ``index.html`` so
deep links work.
"""

from taskito.dashboard.handlers.scaler import build_scaler_response
from taskito.dashboard.server import _make_handler, serve_dashboard
from taskito.dashboard.static import StaticAssets, _content_type_for, _resolve_static_node

__all__ = [
    "StaticAssets",
    "_content_type_for",
    "_make_handler",
    "_resolve_static_node",
    "build_scaler_response",
    "serve_dashboard",
]
