#!/usr/bin/env python3
"""Reproducible screenshot capture for the documentation site.

Spins up a fresh Taskito Queue, seeds it with deterministic demo data
(admin user, sample tasks/queues, webhooks with mixed delivery outcomes,
runtime overrides, a middleware disable), starts the dashboard on a
random port, drives a headless Chromium through every screen, and saves
PNGs under ``docs/public/screenshots/dashboard/``.

Run from the repo root:

    uv run --with playwright python scripts/capture_docs_screenshots.py
    # First time only:
    uv run --with playwright python -m playwright install chromium

The script is **idempotent**: every run overwrites the previous PNGs and
starts from an empty SQLite DB in a temp directory, so there is no
"works on my machine" drift.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import socket
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from taskito import Queue
from taskito.dashboard import _make_handler
from taskito.dashboard.auth import AuthStore
from taskito.dashboard.delivery_store import DeliveryStore
from taskito.events import EventType
from taskito.middleware import TaskMiddleware

ADMIN_USER = "demo-admin"
ADMIN_PASSWORD = "demo-pass-1234"

REPO_ROOT = Path(__file__).resolve().parent.parent
SCREENSHOT_DIR = REPO_ROOT / "docs" / "public" / "screenshots" / "dashboard"


# ── Demo middleware ──────────────────────────────────────────────────


class LoggingMiddleware(TaskMiddleware):
    """Demo middleware that the screenshots reference."""

    name = "demo.logging"


class MetricsMiddleware(TaskMiddleware):
    name = "demo.metrics"


# ── Seed data ────────────────────────────────────────────────────────


# Task body functions are defined at module level so their qualnames stay
# clean (``demo_tasks.send_email`` rather than
# ``capture_docs_screenshots.seed_queue.<locals>.send_email``) — much nicer
# in screenshots. ``seed_queue`` registers them with the live Queue.


def send_email(to: str) -> str:
    return f"sent:{to}"


def deliver_message(message: str) -> str:
    return message


def sync_metrics() -> None:
    pass


send_email.__module__ = "myapp.tasks"
send_email.__qualname__ = "send_email"
deliver_message.__module__ = "myapp.tasks"
deliver_message.__qualname__ = "deliver_message"
sync_metrics.__module__ = "myapp.tasks"
sync_metrics.__qualname__ = "sync_metrics"


def seed_queue(queue: Queue) -> None:
    """Populate the demo queue with realistic data for the screenshots.

    Returns nothing — the dashboard reads everything from storage.
    """
    # Admin user — header drop-down shows "demo-admin" in the screenshots.
    AuthStore(queue).create_user(ADMIN_USER, ADMIN_PASSWORD, role="admin")

    # Tasks — defaults vary so the Tasks table has visual variety.
    queue.task()(send_email)
    queue.task(
        queue="email",
        max_retries=5,
        timeout=120,
        rate_limit="100/m",
        max_concurrent=10,
    )(deliver_message)
    queue.task(queue="metrics", priority=2)(sync_metrics)

    # Queue-level configuration. set_queue_concurrency goes through the
    # same code path as the dashboard override apply.
    queue.set_queue_concurrency("email", 10)

    # Override the send_email task — Tasks page should show this in accent.
    queue.set_task_override(
        next(c.name for c in queue._task_configs if c.name.endswith("send_email")),
        rate_limit="200/m",
        max_retries=10,
    )

    # Webhook subscriptions — one fully configured, one disabled, one
    # filtered to a specific task.
    import os

    os.environ["TASKITO_WEBHOOKS_ALLOW_PRIVATE"] = "1"  # echo server is loopback

    sub1 = queue.add_webhook(
        url="https://hooks.example.com/ops-failures",
        events=[EventType.JOB_FAILED, EventType.JOB_DEAD],
        secret="whsec_demo_signing_secret",
        description="Page ops on permanent job failures",
        max_retries=5,
        timeout=8.0,
    )
    # Second subscription: filters by task name. Captured for visual
    # contrast in the webhooks-list screenshot; we don't reuse its id.
    queue.add_webhook(
        url="https://audit.internal.example.com/taskito-events",
        events=None,
        task_filter=["myapp.tasks.send_email"],
        description="Audit log for send_email only",
    )
    sub3 = queue.add_webhook(
        url="https://staging-hooks.example.com/all-events",
        description="Staging echo — disabled",
    )
    queue.update_webhook(sub3.id, enabled=False)

    # Synthesize delivery history for sub1 so the Deliveries page has rows.
    store = DeliveryStore(queue)
    base_time = int(time.time() * 1000)
    deliveries = [
        ("delivered", 200, 42, "job.completed", "myapp.tasks.process_image"),
        ("delivered", 200, 38, "job.completed", "myapp.tasks.send_email"),
        ("delivered", 200, 51, "job.completed", "myapp.tasks.send_email"),
        ("failed", 504, 9500, "job.failed", "myapp.tasks.process_image"),
        ("delivered", 200, 44, "job.completed", "myapp.tasks.send_email"),
        ("dead", 500, 30000, "job.dead", "myapp.tasks.process_image"),
        ("delivered", 200, 39, "job.completed", "myapp.tasks.send_email"),
    ]
    for i, (status, code, lat, event, task_name) in enumerate(deliveries):
        record = store.record_attempt(
            sub1.id,
            event=event,
            payload={
                "task_name": task_name,
                "job_id": f"01H{i:02d}DEMOXYZ{i}",
                "queue": "default",
            },
            status=status,
            attempts=3 if status == "dead" else 1,
            response_code=code if status != "delivered" or code == 200 else None,
            latency_ms=lat,
            response_body=(
                None
                if status == "delivered"
                else "Internal Server Error\nstack trace here..."
            ),
            task_name=task_name,
            job_id=f"01H{i:02d}DEMOXYZ{i}",
        )
        # Backdate so the "When" column shows a range of relative times.
        _backdate_delivery(queue, sub1.id, record.id, base_time - i * 600_000)

    # Disable one middleware on one task so the Middleware tab has a
    # mix of green / grey toggles.
    send_email_full = next(
        c.name for c in queue._task_configs if c.name.endswith("send_email")
    )
    queue.disable_middleware_for_task(send_email_full, "demo.metrics")


def _backdate_delivery(queue: Queue, sub_id: str, record_id: str, ts: int) -> None:
    """Rewrite a delivery's ``created_at`` so the deliveries table shows
    a believable range of relative times in the screenshot rather than
    a clump of "just now" rows."""
    key = f"webhooks:deliveries:{sub_id}"
    raw = queue.get_setting(key)
    if not raw:
        return
    rows = json.loads(raw)
    for row in rows:
        if row.get("id") == record_id:
            row["created_at"] = ts
            if row.get("completed_at") is not None:
                row["completed_at"] = ts + 50
            queue.set_setting(key, json.dumps(rows, separators=(",", ":")))
            return


# ── Webhook echo server (for the live send-test screenshot) ──────────


def start_echo_server() -> tuple[str, HTTPServer]:
    """Local server the test webhook delivers to during the captures."""

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"ok")

        def log_message(self, *args: Any) -> None:
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return f"http://127.0.0.1:{server.server_address[1]}", server


# ── Dashboard process ────────────────────────────────────────────────


def start_dashboard(queue: Queue) -> tuple[str, ThreadingHTTPServer]:
    """Start the dashboard on a random localhost port."""
    handler = _make_handler(queue)
    # Bind to port 0 → kernel picks a free port.
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_address[1]}"
    _wait_for_port(server.server_address[1])
    return base, server


def _wait_for_port(port: int, timeout: float = 5.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        with socket.socket() as sock:
            try:
                sock.settimeout(0.2)
                sock.connect(("127.0.0.1", port))
                return
            except OSError:
                time.sleep(0.05)
    raise RuntimeError(f"dashboard did not bind on port {port}")


# ── Capture flow ─────────────────────────────────────────────────────


def capture_all(base_url: str) -> None:
    """Walk every dashboard page and save a PNG per screen.

    Uses Playwright's sync API. Each screenshot is named for its target
    location in the docs so the MDX side can reference them by stable path.
    """
    from playwright.sync_api import sync_playwright

    SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Capturing screenshots into {SCREENSHOT_DIR}")

    with sync_playwright() as p:
        # Use the system Chrome so no extra browser download is needed.
        browser = p.chromium.launch(headless=True, channel="chrome")
        # Width 1280 matches the dashboard's ``max-w-[1400px]`` content
        # area; height 800 keeps each capture above-the-fold without huge
        # screenshots. ``deviceScaleFactor=2`` gives crisp HiDPI output.
        context = browser.new_context(
            viewport={"width": 1280, "height": 800},
            device_scale_factor=2,
        )
        page = context.new_page()

        # ── Phase 1: auth ─────────────────────────────────────────
        login_and_screenshot_setup_then_login(page, base_url)

        # Pre-fetch the cookie for the rest of the flow — the dashboard
        # uses session cookies, and after the login flow above we already
        # have them. So the page context is now authenticated.

        # ── Main pages ───────────────────────────────────────────
        capture_each(
            page,
            base_url,
            [
                ("/", "overview"),
                ("/jobs", "jobs"),
                ("/queues", "queues"),
                ("/workers", "workers"),
            ],
            wait_for_text={"/": "Overview", "/jobs": "Jobs", "/queues": "Queues"},
        )

        # ── Phase 2/3: webhooks ──────────────────────────────────
        capture_page(page, f"{base_url}/webhooks", "webhooks-list")
        # Drive the deliveries view via the visible UI — same path an
        # operator would take.
        page.locator('button[aria-label="Webhook actions"]').first.click()
        page.get_by_role("menuitem", name="View deliveries").click()
        page.wait_for_url("**/deliveries", timeout=5000)
        page.wait_for_load_state("networkidle")
        time.sleep(1.2)
        screenshot(page, "webhook-deliveries")

        # Open the create-webhook dialog for the form screenshot.
        page.goto(f"{base_url}/webhooks", wait_until="networkidle")
        page.get_by_role("button", name="New webhook").click()
        page.wait_for_selector("text=Subscribe an HTTP endpoint", timeout=3000)
        time.sleep(0.3)  # let the dialog finish animating in
        screenshot(page, "webhook-create-dialog")

        # ── Phase 4/5: tasks + middleware ────────────────────────
        capture_page(page, f"{base_url}/tasks", "tasks-list")

        page.goto(f"{base_url}/tasks", wait_until="networkidle")
        # First Edit button opens the side sheet.
        page.get_by_role("button", name="Edit").first.click()
        page.wait_for_selector("text=Overrides", timeout=3000)
        time.sleep(0.3)
        screenshot(page, "task-edit-overrides")

        # Switch to the Middleware tab inside the same sheet.
        page.get_by_role("tab", name="Middleware").click()
        page.wait_for_selector("text=demo.logging", timeout=3000)
        time.sleep(0.3)
        screenshot(page, "task-edit-middleware")

        context.close()
        browser.close()
        print(f"OK — captured {len(list(SCREENSHOT_DIR.glob('*.png')))} screenshots")


def login_and_screenshot_setup_then_login(page: Any, base_url: str) -> None:
    """Capture the setup page on a fresh dashboard, then the login page,
    then sign in so subsequent captures are authenticated."""
    # Use a *separate* throwaway DB just for the setup screenshot — the
    # main demo queue already has a user, so /login would show the sign-in
    # form. Easier than tearing down and re-seeding mid-run.
    setup_url = _start_throwaway_dashboard()
    page.goto(setup_url + "/login", wait_until="networkidle")
    page.wait_for_selector("text=Create the first admin", timeout=3000)
    time.sleep(0.3)
    screenshot(page, "auth-setup")

    # Now the real login page on the seeded dashboard.
    page.goto(base_url + "/login", wait_until="networkidle")
    page.wait_for_selector("text=Sign in", timeout=3000)
    time.sleep(0.3)
    screenshot(page, "auth-login")

    # Authenticate so the rest of the captures run inside the AppShell.
    page.fill('input[id="login-username"]', ADMIN_USER)
    page.fill('input[id="login-password"]', ADMIN_PASSWORD)
    page.get_by_role("button", name="Sign in").click()
    page.wait_for_url(f"{base_url}/", timeout=5000)


def _start_throwaway_dashboard() -> str:
    """Spin up a second dashboard against a fresh empty DB just for the
    setup screenshot."""
    tmpdir = tempfile.mkdtemp(prefix="taskito-docs-")
    q = Queue(db_path=f"{tmpdir}/setup.db")
    url, _server = start_dashboard(q)
    return url


def capture_each(
    page: Any,
    base_url: str,
    routes: list[tuple[str, str]],
    *,
    wait_for_text: dict[str, str] | None = None,
) -> None:
    for route, name in routes:
        url = base_url + route
        page.goto(url, wait_until="networkidle")
        expected = (wait_for_text or {}).get(route)
        if expected is not None:
            with contextlib.suppress(Exception):
                page.wait_for_selector(f"text={expected}", timeout=3000)
        time.sleep(0.3)
        screenshot(page, name)


def capture_page(page: Any, url: str, name: str) -> None:
    page.goto(url, wait_until="networkidle")
    time.sleep(0.4)
    screenshot(page, name)


def screenshot(page: Any, name: str) -> None:
    out = SCREENSHOT_DIR / f"{name}.png"
    page.screenshot(path=str(out), full_page=False)
    print(f"  • {out.name}")


def _first_webhook_id(base_url: str) -> str:
    """Pull the demo webhook id straight from the API so the deep link
    in the screenshot script stays in sync with whatever seed_queue
    produced."""
    # NB: the dashboard is auth-gated, so we need the cookie. Simplest
    # approach is a synchronous login via stdlib urllib.
    import urllib.parse

    login = json.dumps({"username": ADMIN_USER, "password": ADMIN_PASSWORD}).encode()
    req = urllib.request.Request(
        f"{base_url}/api/auth/login",
        method="POST",
        data=login,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req) as resp:
        cookies = "; ".join(
            urllib.parse.unquote(c.split(";", 1)[0])
            for c in resp.headers.get_all("Set-Cookie") or []
        )
    list_req = urllib.request.Request(
        f"{base_url}/api/webhooks", headers={"Cookie": cookies}
    )
    with urllib.request.urlopen(list_req) as resp:
        items = json.loads(resp.read())
    return str(items[0]["id"])


# ── Entry point ──────────────────────────────────────────────────────


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--skip-capture",
        action="store_true",
        help="Seed the demo queue and start the dashboard but skip the "
        "Playwright run — useful for poking the seeded data in a browser.",
    )
    args = parser.parse_args(argv)

    tmpdir = tempfile.mkdtemp(prefix="taskito-docs-")
    print(f"Demo DB: {tmpdir}/demo.db")
    queue = Queue(
        db_path=f"{tmpdir}/demo.db",
        middleware=[LoggingMiddleware(), MetricsMiddleware()],
    )
    seed_queue(queue)

    echo_url, _echo = start_echo_server()
    print(f"Echo server: {echo_url}")

    base_url, _dash = start_dashboard(queue)
    print(f"Dashboard:   {base_url}")

    if args.skip_capture:
        print("\nSkipping Playwright. Open the dashboard in a browser. Ctrl+C to exit.")
        try:
            threading.Event().wait()
        except KeyboardInterrupt:
            return 0
        return 0

    try:
        capture_all(base_url)
    except Exception:
        import traceback

        traceback.print_exc()
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
