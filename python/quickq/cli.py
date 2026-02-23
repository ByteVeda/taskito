"""CLI entry point for quickq worker."""

from __future__ import annotations

import argparse
import importlib
import sys


def main() -> None:
    """Parse CLI arguments and dispatch to the appropriate subcommand."""
    parser = argparse.ArgumentParser(
        prog="quickq",
        description="quickq — Rust-powered task queue for Python",
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

    args = parser.parse_args()

    if args.command == "worker":
        run_worker(args)
    else:
        parser.print_help()
        sys.exit(1)


def run_worker(args: argparse.Namespace) -> None:
    """Import the user's Queue instance and start the worker."""
    app_path = args.app

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

    from quickq.app import Queue

    if not isinstance(queue, Queue):
        print(
            f"Error: '{app_path}' is not a Queue instance (got {type(queue).__name__})",
            file=sys.stderr,
        )
        sys.exit(1)

    queues = args.queues.split(",") if args.queues else None
    queue.run_worker(queues=queues)


if __name__ == "__main__":
    main()
