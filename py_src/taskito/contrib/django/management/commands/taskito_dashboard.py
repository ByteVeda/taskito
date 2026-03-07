"""Management command to start the taskito web dashboard."""

from __future__ import annotations

try:
    from django.core.management.base import BaseCommand
except ImportError as e:
    raise ImportError(
        "Django integration requires 'django'. "
        "Install with: pip install taskito[django]"
    ) from e


class Command(BaseCommand):
    help = "Start the taskito web dashboard"

    def add_arguments(self, parser):  # type: ignore[no-untyped-def]
        parser.add_argument(
            "--host", default="127.0.0.1", help="Bind address (default: 127.0.0.1)"
        )
        parser.add_argument("--port", type=int, default=8080, help="Bind port (default: 8080)")

    def handle(self, **options):  # type: ignore[no-untyped-def]
        from taskito.contrib.django.settings import get_queue
        from taskito.dashboard import serve_dashboard

        queue = get_queue()
        serve_dashboard(queue, host=options["host"], port=options["port"])
