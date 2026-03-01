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

    args = parser.parse_args()

    if args.command == "worker":
        run_worker(args)
    elif args.command == "dashboard":
        run_dashboard(args)
    elif args.command == "info":
        run_info(args)
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


if __name__ == "__main__":
    main()
