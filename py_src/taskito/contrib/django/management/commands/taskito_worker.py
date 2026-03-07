"""Management command to start the taskito worker."""

from __future__ import annotations

try:
    from django.core.management.base import BaseCommand
except ImportError as e:
    raise ImportError(
        "Django integration requires 'django'. "
        "Install with: pip install taskito[django]"
    ) from e


class Command(BaseCommand):
    help = "Start the taskito worker process"

    def add_arguments(self, parser):  # type: ignore[no-untyped-def]
        parser.add_argument(
            "--queues",
            type=str,
            default=None,
            help="Comma-separated list of queues to process (default: all)",
        )

    def handle(self, **options):  # type: ignore[no-untyped-def]
        from taskito.contrib.django.settings import get_queue

        queue = get_queue()
        queues = options["queues"].split(",") if options["queues"] else None
        queue.run_worker(queues=queues)
