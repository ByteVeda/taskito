"""Routing tables for the dashboard HTTP server.

Each entry maps a path (or path pattern) to a callable that produces
JSON-serializable data. Handlers may raise
:class:`~taskito.dashboard.errors._BadRequest` (→ 400) or
:class:`~taskito.dashboard.errors._NotFound` (→ 404).
"""

from __future__ import annotations

import re
from typing import Any

from taskito.dashboard.handlers.dead_letters import _handle_dead_letters
from taskito.dashboard.handlers.jobs import (
    _handle_get_job,
    _handle_list_jobs,
    _handle_replay_post,
)
from taskito.dashboard.handlers.logs import _handle_logs
from taskito.dashboard.handlers.metrics import _handle_metrics, _handle_metrics_timeseries
from taskito.dashboard.handlers.queues import _handle_stats_queues
from taskito.dashboard.handlers.scaler import build_scaler_response

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
]

# ── Exact-match POST routes: path → handler(queue) → JSON data ──
POST_ROUTES: dict[str, Any] = {
    "/api/dead-letters/purge": lambda q: {"purged": q.purge_dead(0)},
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
]
