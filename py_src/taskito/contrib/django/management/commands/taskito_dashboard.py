"""Management command to start the taskito web dashboard."""

from __future__ import annotations

try:
    from django.core.management.base import BaseCommand
except ImportError as e:
    raise ImportError(
        "Django integration requires 'django'. Install with: pip install taskito[django]"
    ) from e


class Command(BaseCommand):
    help = "Start the taskito web dashboard"

    def add_arguments(self, parser):  # type: ignore[no-untyped-def]
        from django.conf import settings

        default_host = getattr(settings, "TASKITO_DASHBOARD_HOST", "127.0.0.1")
        default_port = getattr(settings, "TASKITO_DASHBOARD_PORT", 8080)

        parser.add_argument(
            "--host",
            default=default_host,
            help=f"Bind address (default: {default_host})",
        )
        parser.add_argument(
            "--port",
            type=int,
            default=default_port,
            help=f"Bind port (default: {default_port})",
        )

    def handle(self, **options):  # type: ignore[no-untyped-def]
        from taskito.contrib.django.settings import get_queue
        from taskito.dashboard import serve_dashboard

        queue = get_queue()
        serve_dashboard(queue, host=options["host"], port=options["port"])
