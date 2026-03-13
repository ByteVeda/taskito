"""CLI entry point for taskito worker and info commands."""

from __future__ import annotations

import argparse
import importlib
import sys
import time
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from taskito.app import Queue


def main() -> None:
    """Parse CLI arguments and dispatch to the appropriate subcommand."""
    parser = argparse.ArgumentParser(
        prog="taskito",
        description="taskito — Rust-powered task queue for Python",
    )
    subparsers = parser.add_subparsers(dest="command")

    # worker subcommand
    worker_parser = subparsers.add_parser("worker", help="Start a worker process")
    worker_parser.add_argument(
        "--app",
        required=True,
        help="Python path to the Queue instance (e.g., 'myapp.tasks:queue')",
    )
    worker_parser.add_argument(
        "--queues",
        default=None,
        help="Comma-separated list of queues to process (default: all registered)",
    )
    worker_parser.add_argument(
        "--drain-timeout",
        type=int,
        default=None,
        help="Seconds to wait for in-flight jobs during shutdown (default: 30)",
    )

    # dashboard subcommand
    dash_parser = subparsers.add_parser("dashboard", help="Start the web dashboard")
    dash_parser.add_argument(
        "--app",
        required=True,
        help="Python path to the Queue instance (e.g., 'myapp.tasks:queue')",
    )
    dash_parser.add_argument(
        "--host", default="127.0.0.1", help="Bind address (default: 127.0.0.1)"
    )
    dash_parser.add_argument("--port", type=int, default=8080, help="Bind port (default: 8080)")

    # info subcommand
    info_parser = subparsers.add_parser("info", help="Show queue statistics")
    info_parser.add_argument(
        "--app",
        required=True,
        help="Python path to the Queue instance (e.g., 'myapp.tasks:queue')",
    )
    info_parser.add_argument(
        "--watch",
        action="store_true",
        default=False,
        help="Continuously refresh stats every 2 seconds",
    )

    # pause subcommand
    pause_parser = subparsers.add_parser("pause", help="Pause a queue")
    pause_parser.add_argument(
        "--app",
        required=True,
        help="Python path to the Queue instance",
    )
    pause_parser.add_argument("queue_name", help="Queue name to pause")

    # resume subcommand
    resume_parser = subparsers.add_parser("resume", help="Resume a paused queue")
    resume_parser.add_argument(
        "--app",
        required=True,
        help="Python path to the Queue instance",
    )
    resume_parser.add_argument("queue_name", help="Queue name to resume")

    # scaler subcommand
    scaler_parser = subparsers.add_parser("scaler", help="Start a lightweight KEDA metrics server")
    scaler_parser.add_argument(
        "--app",
        required=True,
        help="Python path to the Queue instance (e.g., 'myapp.tasks:queue')",
    )
    scaler_parser.add_argument("--host", default="0.0.0.0", help="Bind address (default: 0.0.0.0)")
    scaler_parser.add_argument("--port", type=int, default=9091, help="Bind port (default: 9091)")
    scaler_parser.add_argument(
        "--target-queue-depth",
        type=int,
        default=10,
        help="Scaling target hint for KEDA (default: 10)",
    )

    # resources subcommand
    res_parser = subparsers.add_parser("resources", help="Show registered resources")
    res_parser.add_argument(
        "--app",
        required=True,
        help="Python path to the Queue instance (e.g., 'myapp.tasks:queue')",
    )

    # reload subcommand
    reload_parser = subparsers.add_parser(
        "reload", help="Reload resources on a running worker via SIGHUP"
    )
    reload_parser.add_argument(
        "--pid", type=int, required=True, help="PID of the running worker process"
    )
    reload_parser.add_argument(
        "--resource",
        default=None,
        help="Reload a specific resource (default: all reloadable)",
    )

    args = parser.parse_args()

    if args.command == "worker":
        run_worker(args)
    elif args.command == "dashboard":
        run_dashboard(args)
    elif args.command == "info":
        run_info(args)
    elif args.command == "pause":
        queue = _load_queue(args.app)
        queue.pause(args.queue_name)
        print(f"Queue '{args.queue_name}' paused")
    elif args.command == "resume":
        queue = _load_queue(args.app)
        queue.resume(args.queue_name)
        print(f"Queue '{args.queue_name}' resumed")
    elif args.command == "scaler":
        run_scaler(args)
    elif args.command == "resources":
        run_resources(args)
    elif args.command == "reload":
        run_reload(args)
    else:
        parser.print_help()
        sys.exit(1)


def _load_queue(app_path: str) -> Queue:
    """Import and return a Queue instance from a 'module:attribute' path."""
    if ":" not in app_path:
        print(
            f"Error: --app must be in 'module:attribute' format, got '{app_path}'",
            file=sys.stderr,
        )
        sys.exit(1)

    module_path, attr_name = app_path.rsplit(":", 1)

    # Ensure cwd is on sys.path so local modules can be imported
    if "" not in sys.path and "." not in sys.path:
        sys.path.insert(0, "")

    try:
        module = importlib.import_module(module_path)
    except ImportError as e:
        print(f"Error: could not import module '{module_path}': {e}", file=sys.stderr)
        sys.exit(1)

    try:
        queue = getattr(module, attr_name)
    except AttributeError:
        print(
            f"Error: module '{module_path}' has no attribute '{attr_name}'",
            file=sys.stderr,
        )
        sys.exit(1)

    from taskito.app import Queue

    if not isinstance(queue, Queue):
        print(
            f"Error: '{app_path}' is not a Queue instance (got {type(queue).__name__})",
            file=sys.stderr,
        )
        sys.exit(1)

    return queue


def run_worker(args: argparse.Namespace) -> None:
    """Import the user's Queue instance and start the worker."""
    queue = _load_queue(args.app)
    if args.drain_timeout is not None:
        queue._drain_timeout = args.drain_timeout
    queues = args.queues.split(",") if args.queues else None
    queue.run_worker(queues=queues)


def run_dashboard(args: argparse.Namespace) -> None:
    """Start the web dashboard."""
    queue = _load_queue(args.app)
    from taskito.dashboard import serve_dashboard

    serve_dashboard(queue, host=args.host, port=args.port)


def run_info(args: argparse.Namespace) -> None:
    """Print queue statistics."""
    queue = _load_queue(args.app)

    if args.watch:
        _watch_stats(queue)
    else:
        _print_stats(queue)


def _print_stats(queue: Queue) -> None:
    """Print stats once."""
    stats = queue.stats()
    print("taskito queue statistics")
    print("-" * 30)
    for key in ("pending", "running", "completed", "failed", "dead", "cancelled"):
        print(f"  {key:<12} {stats.get(key, 0)}")
    total = sum(stats.values())
    print("-" * 30)
    print(f"  {'total':<12} {total}")


def _watch_stats(queue: Queue) -> None:
    """Refresh stats every 2 seconds with throughput."""
    prev_completed = 0
    try:
        while True:
            print("\033[2J\033[H", end="")
            stats = queue.stats()
            completed = stats.get("completed", 0)
            throughput = (completed - prev_completed) / 2.0
            prev_completed = completed

            _print_stats(queue)
            if throughput > 0:
                print(f"\n  throughput   {throughput:.1f} jobs/s")
            print("\nRefreshing every 2s... (Ctrl+C to stop)")
            time.sleep(2)
    except KeyboardInterrupt:
        pass


def run_scaler(args: argparse.Namespace) -> None:
    """Start the lightweight KEDA metrics server."""
    queue = _load_queue(args.app)
    from taskito.scaler import serve_scaler

    serve_scaler(
        queue,
        host=args.host,
        port=args.port,
        target_queue_depth=args.target_queue_depth,
    )


def run_resources(args: argparse.Namespace) -> None:
    """Print resource status from registered definitions or live runtime."""
    queue = _load_queue(args.app)
    resources = queue.resource_status()
    if not resources:
        print("No resources registered.")
        return

    header = (
        f"{'RESOURCE':<20} {'SCOPE':<10} {'HEALTH':<16} "
        f"{'INIT (ms)':<12} {'RECREATIONS':<14} DEPENDS ON"
    )
    print(header)
    print("-" * len(header))
    for r in resources:
        deps = ", ".join(r["depends_on"]) if r["depends_on"] else "-"
        line = (
            f"{r['name']:<20} {r['scope']:<10} {r['health']:<16} "
            f"{r['init_duration_ms']:<12.2f} {r['recreations']:<14} {deps}"
        )
        print(line)
        # Show pool stats for task-scoped resources
        pool = r.get("pool")
        if pool:
            print(
                f"  {'':>20} pool: "
                f"active={pool['active']} idle={pool['idle']} "
                f"max={pool['size']} "
                f"timeouts={pool['total_timeouts']}"
            )


def run_reload(args: argparse.Namespace) -> None:
    """Send SIGHUP to a running worker to reload resources."""
    import os
    import signal as sig

    if not hasattr(sig, "SIGHUP"):
        print("Error: SIGHUP is not available on this platform", file=sys.stderr)
        sys.exit(1)

    try:
        os.kill(args.pid, sig.SIGHUP)
        print(f"Sent SIGHUP to worker (PID {args.pid})")
    except ProcessLookupError:
        print(f"Error: no process with PID {args.pid}", file=sys.stderr)
        sys.exit(1)
    except PermissionError:
        print(
            f"Error: permission denied sending signal to PID {args.pid}",
            file=sys.stderr,
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
