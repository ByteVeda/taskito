"""Tests for dashboard authentication.

Covers the auth helpers in :mod:`taskito.dashboard.auth` and the HTTP
endpoints under ``/api/auth/*``, plus the session-gating behaviour the
server applies to every other API route.
"""

from __future__ import annotations

import json
import threading
import urllib.error
import urllib.request
from collections.abc import Generator
from http.server import ThreadingHTTPServer
from pathlib import Path
from typing import Any

import pytest

from taskito import Queue
from taskito.dashboard import _make_handler
from taskito.dashboard.auth import (
    AuthStore,
    bootstrap_admin_from_env,
    hash_password,
    verify_password,
)


@pytest.fixture
def queue(tmp_path: Path) -> Queue:
    return Queue(db_path=str(tmp_path / "auth.db"))


# ── Password hashing primitives ─────────────────────────────────────────


def test_hash_password_round_trip() -> None:
    encoded = hash_password("hunter2-correct-horse")
    assert verify_password("hunter2-correct-horse", encoded) is True
    assert verify_password("wrong", encoded) is False


def test_hash_password_produces_unique_salts() -> None:
    a = hash_password("same-password")
    b = hash_password("same-password")
    assert a != b, "different salts must produce different hashes"
    assert verify_password("same-password", a)
    assert verify_password("same-password", b)


def test_verify_password_rejects_malformed_encoding() -> None:
    assert verify_password("anything", "not-a-real-hash") is False
    assert verify_password("anything", "scrypt$xxx$yyy$zzz") is False
    assert verify_password("anything", "pbkdf2_sha256$abc$def$ghi") is False


# ── AuthStore: users ────────────────────────────────────────────────────


def test_count_users_starts_at_zero(queue: Queue) -> None:
    assert AuthStore(queue).count_users() == 0


def test_create_user_persists(queue: Queue) -> None:
    store = AuthStore(queue)
    user = store.create_user("alice", "hunter2-secret")
    assert user.username == "alice"
    assert user.role == "admin"
    assert store.count_users() == 1
    assert store.get_user("alice") is not None
    assert store.get_user("missing") is None


def test_create_user_rejects_duplicate(queue: Queue) -> None:
    store = AuthStore(queue)
    store.create_user("alice", "hunter2-secret")
    with pytest.raises(ValueError, match="already exists"):
        store.create_user("alice", "another-pass")


def test_create_user_validates_username(queue: Queue) -> None:
    store = AuthStore(queue)
    with pytest.raises(ValueError, match="empty"):
        store.create_user("", "hunter2-secret")
    with pytest.raises(ValueError, match="may only contain"):
        store.create_user("alice bob", "hunter2-secret")


def test_create_user_validates_password(queue: Queue) -> None:
    store = AuthStore(queue)
    with pytest.raises(ValueError, match=">= 8 chars"):
        store.create_user("alice", "short")


def test_authenticate(queue: Queue) -> None:
    store = AuthStore(queue)
    store.create_user("alice", "hunter2-secret")
    assert store.authenticate("alice", "hunter2-secret") is not None
    assert store.authenticate("alice", "wrong") is None
    # Unknown username also returns None, without timing leak (we don't
    # assert timing here, just behaviour).
    assert store.authenticate("bob", "anything") is None


def test_authenticate_updates_last_login(queue: Queue) -> None:
    store = AuthStore(queue)
    store.create_user("alice", "hunter2-secret")
    assert store.get_user("alice").last_login_at is None  # type: ignore[union-attr]
    store.authenticate("alice", "hunter2-secret")
    assert store.get_user("alice").last_login_at is not None  # type: ignore[union-attr]


def test_delete_user(queue: Queue) -> None:
    store = AuthStore(queue)
    store.create_user("alice", "hunter2-secret")
    assert store.delete_user("alice") is True
    assert store.delete_user("alice") is False
    assert store.get_user("alice") is None


def test_update_password(queue: Queue) -> None:
    store = AuthStore(queue)
    store.create_user("alice", "hunter2-secret")
    store.update_password("alice", "new-secure-pass")
    assert store.authenticate("alice", "new-secure-pass") is not None
    assert store.authenticate("alice", "hunter2-secret") is None


# ── AuthStore: sessions ────────────────────────────────────────────────


def test_create_and_get_session(queue: Queue) -> None:
    store = AuthStore(queue)
    user = store.create_user("alice", "hunter2-secret")
    session = store.create_session(user)
    fetched = store.get_session(session.token)
    assert fetched is not None
    assert fetched.username == "alice"
    assert fetched.csrf_token == session.csrf_token
    assert not fetched.is_expired()


def test_get_session_unknown_token_returns_none(queue: Queue) -> None:
    assert AuthStore(queue).get_session("nope") is None
    assert AuthStore(queue).get_session("") is None


def test_delete_session(queue: Queue) -> None:
    store = AuthStore(queue)
    user = store.create_user("alice", "hunter2-secret")
    session = store.create_session(user)
    assert store.delete_session(session.token) is True
    assert store.get_session(session.token) is None
    assert store.delete_session(session.token) is False


def test_expired_sessions_pruned_on_lookup(queue: Queue) -> None:
    store = AuthStore(queue)
    user = store.create_user("alice", "hunter2-secret")
    session = store.create_session(user, ttl_seconds=0)
    # ttl_seconds=0 means it expires immediately.
    assert store.get_session(session.token) is None


def test_prune_expired_sessions(queue: Queue) -> None:
    store = AuthStore(queue)
    user = store.create_user("alice", "hunter2-secret")
    long_lived = store.create_session(user, ttl_seconds=3600)
    short_lived = store.create_session(user, ttl_seconds=0)
    removed = store.prune_expired_sessions()
    assert removed >= 1
    assert store.get_session(long_lived.token) is not None
    assert store.get_session(short_lived.token) is None


# ── Env bootstrap ──────────────────────────────────────────────────────


def test_bootstrap_admin_from_env(queue: Queue, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TASKITO_DASHBOARD_ADMIN_USER", "envadmin")
    monkeypatch.setenv("TASKITO_DASHBOARD_ADMIN_PASSWORD", "from-environ-pass")
    user = bootstrap_admin_from_env(queue)
    assert user is not None
    assert user.username == "envadmin"

    # Idempotent — second call is a no-op.
    again = bootstrap_admin_from_env(queue)
    assert again is None


def test_bootstrap_admin_noop_without_env(queue: Queue, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("TASKITO_DASHBOARD_ADMIN_USER", raising=False)
    monkeypatch.delenv("TASKITO_DASHBOARD_ADMIN_PASSWORD", raising=False)
    assert bootstrap_admin_from_env(queue) is None
    assert AuthStore(queue).count_users() == 0


# ── HTTP endpoints ─────────────────────────────────────────────────────


@pytest.fixture
def dashboard_server(queue: Queue) -> Generator[tuple[str, Queue]]:
    handler = _make_handler(queue)
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{port}", queue
    finally:
        server.shutdown()


def _get(url: str, *, cookies: dict[str, str] | None = None) -> tuple[int, Any, dict[str, str]]:
    req = urllib.request.Request(url, method="GET")
    if cookies:
        req.add_header("Cookie", "; ".join(f"{k}={v}" for k, v in cookies.items()))
    try:
        resp = urllib.request.urlopen(req)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}"), dict(e.headers or {})
    body = json.loads(resp.read() or b"{}")
    set_cookies = resp.headers.get_all("Set-Cookie") or []
    return resp.status, body, {"Set-Cookie": "\n".join(set_cookies)}


def _post(
    url: str,
    body: dict | None = None,
    *,
    cookies: dict[str, str] | None = None,
    headers: dict[str, str] | None = None,
) -> tuple[int, Any, dict[str, str]]:
    data = json.dumps(body or {}).encode()
    req = urllib.request.Request(url, method="POST", data=data)
    req.add_header("Content-Type", "application/json")
    if cookies:
        req.add_header("Cookie", "; ".join(f"{k}={v}" for k, v in cookies.items()))
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        resp = urllib.request.urlopen(req)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}"), dict(e.headers or {})
    parsed = json.loads(resp.read() or b"{}")
    set_cookies = resp.headers.get_all("Set-Cookie") or []
    return resp.status, parsed, {"Set-Cookie": "\n".join(set_cookies)}


def _parse_set_cookie(raw: str) -> dict[str, str]:
    """Pull out the cookie name→value pairs from one or more Set-Cookie lines."""
    out: dict[str, str] = {}
    for line in raw.splitlines():
        if not line:
            continue
        nv = line.split(";", 1)[0]
        if "=" in nv:
            name, value = nv.split("=", 1)
            out[name.strip()] = value.strip()
    return out


def test_auth_status_before_setup(dashboard_server: tuple[str, Queue]) -> None:
    base, _ = dashboard_server
    status, body, _ = _get(f"{base}/api/auth/status")
    assert status == 200
    assert body == {"setup_required": True}


def test_protected_route_returns_503_before_setup(dashboard_server: tuple[str, Queue]) -> None:
    base, _ = dashboard_server
    status, body, _ = _get(f"{base}/api/stats")
    assert status == 503
    assert body == {"error": "setup_required"}


def test_setup_creates_first_admin(dashboard_server: tuple[str, Queue]) -> None:
    base, queue = dashboard_server
    status, body, _ = _post(
        f"{base}/api/auth/setup",
        {"username": "alice", "password": "hunter2-secret"},
    )
    assert status == 200
    assert body["user"]["username"] == "alice"
    assert AuthStore(queue).count_users() == 1


def test_setup_blocked_after_first_user(dashboard_server: tuple[str, Queue]) -> None:
    base, queue = dashboard_server
    AuthStore(queue).create_user("alice", "hunter2-secret")
    status, body, _ = _post(
        f"{base}/api/auth/setup",
        {"username": "mallory", "password": "hijack-attempt"},
    )
    assert status == 400
    assert "setup already complete" in body["error"]


def test_login_and_session_cookie(dashboard_server: tuple[str, Queue]) -> None:
    base, queue = dashboard_server
    AuthStore(queue).create_user("alice", "hunter2-secret")
    status, body, headers = _post(
        f"{base}/api/auth/login",
        {"username": "alice", "password": "hunter2-secret"},
    )
    assert status == 200
    assert body["user"]["username"] == "alice"
    # Token must NOT leak in the body — it lives only in the HttpOnly cookie.
    assert "token" not in body["session"]

    cookies = _parse_set_cookie(headers["Set-Cookie"])
    assert "taskito_session" in cookies
    assert "taskito_csrf" in cookies
    # HttpOnly must be set on the session cookie.
    assert "HttpOnly" in headers["Set-Cookie"]
    # CSRF cookie value must match what whoami says.
    sess_token = cookies["taskito_session"]
    csrf = cookies["taskito_csrf"]
    status, body, _ = _get(f"{base}/api/auth/whoami", cookies={"taskito_session": sess_token})
    assert status == 200
    assert body["user"]["username"] == "alice"
    assert body["csrf_token"] == csrf


def test_login_with_wrong_password(dashboard_server: tuple[str, Queue]) -> None:
    base, queue = dashboard_server
    AuthStore(queue).create_user("alice", "hunter2-secret")
    status, body, _ = _post(
        f"{base}/api/auth/login",
        {"username": "alice", "password": "nope"},
    )
    assert status == 400
    assert body["error"] == "invalid_credentials"


def test_whoami_without_session_returns_404(dashboard_server: tuple[str, Queue]) -> None:
    base, queue = dashboard_server
    AuthStore(queue).create_user("alice", "hunter2-secret")
    status, body, _ = _get(f"{base}/api/auth/whoami")
    assert status == 401
    assert body["error"] == "not_authenticated"


def test_protected_get_requires_session(dashboard_server: tuple[str, Queue]) -> None:
    base, queue = dashboard_server
    AuthStore(queue).create_user("alice", "hunter2-secret")
    status, _, _ = _get(f"{base}/api/stats")
    assert status == 401


def test_protected_get_works_with_session(dashboard_server: tuple[str, Queue]) -> None:
    base, queue = dashboard_server
    store = AuthStore(queue)
    user = store.create_user("alice", "hunter2-secret")
    session = store.create_session(user)
    status, _, _ = _get(f"{base}/api/stats", cookies={"taskito_session": session.token})
    assert status == 200


def test_post_requires_csrf(dashboard_server: tuple[str, Queue]) -> None:
    base, queue = dashboard_server
    store = AuthStore(queue)
    user = store.create_user("alice", "hunter2-secret")
    session = store.create_session(user)
    # POST with only the session cookie but no CSRF → 403.
    status, body, _ = _post(
        f"{base}/api/dead-letters/purge",
        {},
        cookies={"taskito_session": session.token},
    )
    assert status == 403
    assert body["error"] == "csrf_failed"


def test_post_succeeds_with_valid_csrf(dashboard_server: tuple[str, Queue]) -> None:
    base, queue = dashboard_server
    store = AuthStore(queue)
    user = store.create_user("alice", "hunter2-secret")
    session = store.create_session(user)
    status, _, _ = _post(
        f"{base}/api/dead-letters/purge",
        {},
        cookies={
            "taskito_session": session.token,
            "taskito_csrf": session.csrf_token,
        },
        headers={"X-CSRF-Token": session.csrf_token},
    )
    assert status == 200


def test_post_rejected_when_csrf_mismatched(dashboard_server: tuple[str, Queue]) -> None:
    base, queue = dashboard_server
    store = AuthStore(queue)
    user = store.create_user("alice", "hunter2-secret")
    session = store.create_session(user)
    status, body, _ = _post(
        f"{base}/api/dead-letters/purge",
        {},
        cookies={
            "taskito_session": session.token,
            "taskito_csrf": session.csrf_token,
        },
        headers={"X-CSRF-Token": "different-value"},
    )
    assert status == 403
    assert body["error"] == "csrf_failed"


def test_logout_invalidates_session(dashboard_server: tuple[str, Queue]) -> None:
    base, queue = dashboard_server
    store = AuthStore(queue)
    user = store.create_user("alice", "hunter2-secret")
    session = store.create_session(user)
    status, _, _ = _post(
        f"{base}/api/auth/logout",
        {},
        cookies={
            "taskito_session": session.token,
            "taskito_csrf": session.csrf_token,
        },
        headers={"X-CSRF-Token": session.csrf_token},
    )
    assert status == 200
    assert AuthStore(queue).get_session(session.token) is None


def test_change_password_flow(dashboard_server: tuple[str, Queue]) -> None:
    base, queue = dashboard_server
    store = AuthStore(queue)
    user = store.create_user("alice", "hunter2-secret")
    session = store.create_session(user)
    status, _, _ = _post(
        f"{base}/api/auth/change-password",
        {"old_password": "hunter2-secret", "new_password": "brand-new-secure"},
        cookies={
            "taskito_session": session.token,
            "taskito_csrf": session.csrf_token,
        },
        headers={"X-CSRF-Token": session.csrf_token},
    )
    assert status == 200
    assert store.authenticate("alice", "brand-new-secure") is not None
    assert store.authenticate("alice", "hunter2-secret") is None


def test_health_endpoint_is_public(dashboard_server: tuple[str, Queue]) -> None:
    base, queue = dashboard_server
    AuthStore(queue).create_user("alice", "hunter2-secret")
    status, _, _ = _get(f"{base}/health")
    assert status == 200
