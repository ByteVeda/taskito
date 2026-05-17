"""Routing tables for the dashboard HTTP server.

Each entry maps a path (or path pattern) to a callable that produces
JSON-serializable data. Handlers may raise
:class:`~taskito.dashboard.errors._BadRequest` (→ 400) or
:class:`~taskito.dashboard.errors._NotFound` (→ 404).

Authentication and authorization:

- ``PUBLIC_PATHS`` — exact paths that bypass auth entirely. Used for the
  setup/login/status endpoints, health checks, and Prometheus metrics.
- Routes outside ``PUBLIC_PATHS`` require a valid session cookie when at
  least one user exists in the auth store. Without users, the server
  returns ``503 setup_required`` for every API route so the SPA can show
  the setup flow.
- State-changing routes (POST/PUT/DELETE) additionally require a valid
  CSRF token. Login and setup are exempt because no session exists yet.
"""

from __future__ import annotations

import re
from typing import Any

from taskito.dashboard.handlers.auth import (
    handle_auth_status,
    handle_change_password,
    handle_login,
    handle_logout,
    handle_setup,
    handle_whoami,
)
from taskito.dashboard.handlers.dead_letters import _handle_dead_letters
from taskito.dashboard.handlers.jobs import (
    _handle_get_job,
    _handle_list_jobs,
    _handle_replay_post,
)
from taskito.dashboard.handlers.logs import _handle_logs
from taskito.dashboard.handlers.metrics import _handle_metrics, _handle_metrics_timeseries
from taskito.dashboard.handlers.middleware import (
    handle_delete_task_middleware,
    handle_get_task_middleware,
    handle_list_middleware,
    handle_put_task_middleware,
)
from taskito.dashboard.handlers.overrides import (
    handle_delete_queue_override,
    handle_delete_task_override,
    handle_get_queue_override,
    handle_get_task_override,
    handle_list_queues,
    handle_list_tasks,
    handle_put_queue_override,
    handle_put_task_override,
)
from taskito.dashboard.handlers.queues import _handle_stats_queues
from taskito.dashboard.handlers.scaler import build_scaler_response
from taskito.dashboard.handlers.settings import (
    _handle_delete_setting,
    _handle_get_setting,
    _handle_list_settings,
    _handle_set_setting,
)
from taskito.dashboard.handlers.webhook_deliveries import (
    handle_get_delivery,
    handle_list_deliveries,
    handle_replay_delivery,
)
from taskito.dashboard.handlers.webhooks import (
    handle_create_webhook,
    handle_delete_webhook,
    handle_get_webhook,
    handle_list_event_types,
    handle_list_webhooks,
    handle_rotate_secret,
    handle_test_webhook,
    handle_update_webhook,
)

# ── Auth-exempt paths ──────────────────────────────────────────────────
#
# These bypass the session check. Static SPA files are also exempt but
# they are served outside the API dispatcher.
PUBLIC_PATHS: frozenset[str] = frozenset(
    {
        "/api/auth/status",
        "/api/auth/login",
        "/api/auth/setup",
        "/health",
        "/readiness",
        "/metrics",
    }
)

# Paths handled directly by the server (live outside the regular dispatch
# tables because they take a RequestContext as well as the queue).
AUTH_CONTEXT_GET_PATHS: frozenset[str] = frozenset({"/api/auth/whoami"})
AUTH_CONTEXT_POST_PATHS: frozenset[str] = frozenset(
    {"/api/auth/logout", "/api/auth/change-password"}
)


# ── Exact-match GET routes: path → handler(queue, qs) → JSON data ──
GET_ROUTES: dict[str, Any] = {
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
    "/api/scaler": lambda q, qs: build_scaler_response(q, queue_name=qs.get("queue", [None])[0]),
    "/api/settings": _handle_list_settings,
    "/api/auth/status": handle_auth_status,
    "/api/webhooks": handle_list_webhooks,
    "/api/event-types": handle_list_event_types,
    "/api/tasks": handle_list_tasks,
    "/api/queues": handle_list_queues,
    "/api/middleware": handle_list_middleware,
}

# ── Parameterized GET routes: regex → handler(queue, qs, captured_id) ──
# Order matters — more specific patterns first.
GET_PARAM_ROUTES: list[tuple[re.Pattern, Any]] = [
    (re.compile(r"^/api/jobs/([^/]+)/errors$"), lambda q, qs, jid: q.job_errors(jid)),
    (re.compile(r"^/api/jobs/([^/]+)/logs$"), lambda q, qs, jid: q.task_logs(jid)),
    (
        re.compile(r"^/api/jobs/([^/]+)/replay-history$"),
        lambda q, qs, jid: q.replay_history(jid),
    ),
    (re.compile(r"^/api/jobs/([^/]+)/dag$"), lambda q, qs, jid: q.job_dag(jid)),
    (re.compile(r"^/api/jobs/([^/]+)$"), _handle_get_job),
    (re.compile(r"^/api/settings/(.+)$"), _handle_get_setting),
    (
        re.compile(r"^/api/webhooks/([^/]+)/deliveries$"),
        handle_list_deliveries,
    ),
    (re.compile(r"^/api/webhooks/([^/]+)$"), handle_get_webhook),
    (re.compile(r"^/api/tasks/([^/]+)/override$"), handle_get_task_override),
    (re.compile(r"^/api/queues/([^/]+)/override$"), handle_get_queue_override),
    (re.compile(r"^/api/tasks/([^/]+)/middleware$"), handle_get_task_middleware),
]

# GET routes with 2 captured groups (handler signature: queue, qs, (g1, g2))
GET_PARAM2_ROUTES: list[tuple[re.Pattern, Any]] = [
    (
        re.compile(r"^/api/webhooks/([^/]+)/deliveries/([^/]+)$"),
        handle_get_delivery,
    ),
]

# ── Exact-match POST routes: path → handler(queue) → JSON data ──
POST_ROUTES: dict[str, Any] = {
    "/api/dead-letters/purge": lambda q: {"purged": q.purge_dead(0)},
}

# Exact-match POST routes that take a body (path → handler(queue, body))
POST_BODY_ROUTES: dict[str, Any] = {
    "/api/auth/login": handle_login,
    "/api/auth/setup": handle_setup,
    "/api/webhooks": handle_create_webhook,
}

# Auth-context POST routes: path → handler(queue, ctx) — no body
POST_CTX_ROUTES: dict[str, Any] = {
    "/api/auth/logout": handle_logout,
}

# Auth-context POST routes with body: path → handler(queue, body, ctx)
POST_CTX_BODY_ROUTES: dict[str, Any] = {
    "/api/auth/change-password": handle_change_password,
}

# Auth-context GET routes: path → handler(queue, ctx)
GET_CTX_ROUTES: dict[str, Any] = {
    "/api/auth/whoami": handle_whoami,
}

# ── Parameterized POST routes: regex → handler(queue, captured_id) ──
POST_PARAM_ROUTES: list[tuple[re.Pattern, Any]] = [
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
    (re.compile(r"^/api/webhooks/([^/]+)/test$"), handle_test_webhook),
    (re.compile(r"^/api/webhooks/([^/]+)/rotate-secret$"), handle_rotate_secret),
]

# Routes with two captures (sub_id + delivery_id) — handled by the POST
# dispatcher when patterns yield 2 groups.
POST_PARAM2_ROUTES: list[tuple[re.Pattern, Any]] = [
    (
        re.compile(r"^/api/webhooks/([^/]+)/deliveries/([^/]+)/replay$"),
        handle_replay_delivery,
    ),
]

# ── Parameterized PUT routes: regex → handler(queue, body, captured_id) ──
PUT_PARAM_ROUTES: list[tuple[re.Pattern, Any]] = [
    (re.compile(r"^/api/settings/(.+)$"), _handle_set_setting),
    (re.compile(r"^/api/webhooks/([^/]+)$"), handle_update_webhook),
    (re.compile(r"^/api/tasks/([^/]+)/override$"), handle_put_task_override),
    (re.compile(r"^/api/queues/([^/]+)/override$"), handle_put_queue_override),
]

# PUT routes with 2 captured groups (handler signature: queue, body, (g1, g2))
PUT_PARAM2_ROUTES: list[tuple[re.Pattern, Any]] = [
    (
        re.compile(r"^/api/tasks/([^/]+)/middleware/([^/]+)$"),
        handle_put_task_middleware,
    ),
]

# ── Parameterized DELETE routes: regex → handler(queue, captured_id) ──
DELETE_PARAM_ROUTES: list[tuple[re.Pattern, Any]] = [
    (re.compile(r"^/api/settings/(.+)$"), _handle_delete_setting),
    (re.compile(r"^/api/webhooks/([^/]+)$"), handle_delete_webhook),
    (re.compile(r"^/api/tasks/([^/]+)/override$"), handle_delete_task_override),
    (re.compile(r"^/api/queues/([^/]+)/override$"), handle_delete_queue_override),
    (re.compile(r"^/api/tasks/([^/]+)/middleware$"), handle_delete_task_middleware),
]


def is_state_changing_method(method: str) -> bool:
    """POST/PUT/DELETE/PATCH all require a CSRF token."""
    return method in {"POST", "PUT", "DELETE", "PATCH"}


def is_csrf_exempt(path: str) -> bool:
    """Login and setup happen before a session exists, so they're CSRF-exempt.

    Every other state-changing endpoint requires a valid CSRF token even
    though the session cookie is enforced — defense in depth.
    """
    return path in {"/api/auth/login", "/api/auth/setup"}
