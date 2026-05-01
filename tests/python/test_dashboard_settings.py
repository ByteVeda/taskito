"""Tests for the dashboard settings key/value store.

Covers:
- ``Queue.get_setting`` / ``set_setting`` / ``delete_setting`` / ``list_settings``
- HTTP endpoints under ``/api/settings``
"""

from __future__ import annotations

import json
import threading
import urllib.error
import urllib.request
from collections.abc import Generator
from pathlib import Path
from typing import Any

import pytest

from taskito import Queue


@pytest.fixture
def queue(tmp_path: Path) -> Queue:
    return Queue(db_path=str(tmp_path / "settings.db"))


def _put(url: str, body: dict) -> Any:
    req = urllib.request.Request(
        url,
        method="PUT",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def _delete(url: str) -> Any:
    req = urllib.request.Request(url, method="DELETE")
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def _get(url: str) -> Any:
    with urllib.request.urlopen(url) as resp:
        return json.loads(resp.read())


# ── Python API ──────────────────────────────────────────


def test_get_setting_returns_none_when_unset(queue: Queue) -> None:
    assert queue.get_setting("missing") is None


def test_set_and_get_setting(queue: Queue) -> None:
    queue.set_setting("dashboard.title", "My Queue")
    assert queue.get_setting("dashboard.title") == "My Queue"


def test_set_setting_overwrites(queue: Queue) -> None:
    queue.set_setting("k", "v1")
    queue.set_setting("k", "v2")
    assert queue.get_setting("k") == "v2"


def test_delete_setting(queue: Queue) -> None:
    queue.set_setting("k", "v")
    assert queue.delete_setting("k") is True
    assert queue.get_setting("k") is None
    # Delete on missing key is a no-op returning False.
    assert queue.delete_setting("k") is False


def test_list_settings_returns_all(queue: Queue) -> None:
    queue.set_setting("a", "1")
    queue.set_setting("b", "2")
    snapshot = queue.list_settings()
    assert snapshot == {"a": "1", "b": "2"}


def test_setting_preserves_unicode(queue: Queue) -> None:
    queue.set_setting("greeting", "안녕하세요 🌏")
    assert queue.get_setting("greeting") == "안녕하세요 🌏"


def test_setting_preserves_json(queue: Queue) -> None:
    payload = json.dumps({"label": "Grafana", "url": "https://example/dash"})
    queue.set_setting("dashboard.links.0", payload)
    assert json.loads(queue.get_setting("dashboard.links.0") or "") == {
        "label": "Grafana",
        "url": "https://example/dash",
    }


# ── HTTP endpoints ──────────────────────────────────────


@pytest.fixture
def dashboard_server(queue: Queue) -> Generator[tuple[str, Queue]]:
    from http.server import ThreadingHTTPServer

    from taskito.dashboard import _make_handler

    handler = _make_handler(queue)
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{port}", queue
    finally:
        server.shutdown()


def test_get_settings_returns_empty_dict(dashboard_server: tuple[str, Queue]) -> None:
    base, _ = dashboard_server
    assert _get(f"{base}/api/settings") == {}


def test_put_then_get_setting(dashboard_server: tuple[str, Queue]) -> None:
    base, _ = dashboard_server
    _put(f"{base}/api/settings/dashboard.title", {"value": "My Queue"})

    data = _get(f"{base}/api/settings/dashboard.title")
    assert data == {"key": "dashboard.title", "value": "My Queue"}

    snapshot = _get(f"{base}/api/settings")
    assert snapshot == {"dashboard.title": "My Queue"}


def test_put_setting_with_json_value(dashboard_server: tuple[str, Queue]) -> None:
    """Non-string ``value`` is JSON-encoded before persistence."""
    base, queue = dashboard_server
    payload = [
        {"label": "Grafana", "url": "https://grafana.example/d/abc"},
        {"label": "Sentry", "url": "https://sentry.example/issues"},
    ]
    _put(f"{base}/api/settings/dashboard.external_links", {"value": payload})

    stored = queue.get_setting("dashboard.external_links")
    assert stored is not None
    assert json.loads(stored) == payload


def test_get_unknown_setting_returns_404(dashboard_server: tuple[str, Queue]) -> None:
    base, _ = dashboard_server
    with pytest.raises(urllib.error.HTTPError) as exc_info:
        _get(f"{base}/api/settings/missing.key")
    assert exc_info.value.code == 404


def test_put_setting_with_missing_value_field_returns_400(
    dashboard_server: tuple[str, Queue],
) -> None:
    base, _ = dashboard_server
    with pytest.raises(urllib.error.HTTPError) as exc_info:
        _put(f"{base}/api/settings/k", {"not_value": 1})
    assert exc_info.value.code == 400


def test_put_setting_rejects_invalid_json_body(dashboard_server: tuple[str, Queue]) -> None:
    base, _ = dashboard_server
    req = urllib.request.Request(
        f"{base}/api/settings/k",
        method="PUT",
        data=b"{not json",
        headers={"Content-Type": "application/json"},
    )
    with pytest.raises(urllib.error.HTTPError) as exc_info:
        urllib.request.urlopen(req)
    assert exc_info.value.code == 400


def test_delete_setting_returns_true_when_exists(
    dashboard_server: tuple[str, Queue],
) -> None:
    base, queue = dashboard_server
    queue.set_setting("k", "v")
    assert _delete(f"{base}/api/settings/k") == {"deleted": True}
    assert queue.get_setting("k") is None


def test_delete_missing_setting_returns_false(
    dashboard_server: tuple[str, Queue],
) -> None:
    base, _ = dashboard_server
    assert _delete(f"{base}/api/settings/missing") == {"deleted": False}


def test_settings_persist_across_queue_instances(tmp_path: Path) -> None:
    """A fresh Queue instance pointed at the same DB sees prior writes."""
    db = str(tmp_path / "persist.db")
    q1 = Queue(db_path=db)
    q1.set_setting("k", "v")

    q2 = Queue(db_path=db)
    assert q2.get_setting("k") == "v"
