"""Tests for CLI info command."""

from pathlib import Path

import pytest

from taskito.cli import _build_parser, _load_queue, _print_stats


def test_load_queue_invalid_format() -> None:
    """_load_queue rejects paths without a colon."""
    with pytest.raises(SystemExit):
        _load_queue("no_colon_here")


def test_load_queue_missing_module() -> None:
    """_load_queue exits on missing module."""
    with pytest.raises(SystemExit):
        _load_queue("nonexistent.module:queue")


def test_print_stats_format(capsys: pytest.CaptureFixture[str], tmp_path: Path) -> None:
    """_print_stats prints a formatted stats table."""
    from taskito import Queue

    db_path = str(tmp_path / "test_cli_stats.db")
    queue = Queue(db_path=db_path)

    @queue.task()
    def noop() -> None:
        pass

    noop.delay()
    noop.delay()

    _print_stats(queue)
    output = capsys.readouterr().out

    assert "taskito queue statistics" in output
    assert "pending" in output
    assert "total" in output


def test_autoscale_requires_app() -> None:
    """autoscale subcommand fails without --app."""
    parser = _build_parser()
    with pytest.raises(SystemExit) as exc_info:
        parser.parse_args(["autoscale"])
    assert exc_info.value.code == 2


def test_autoscale_default_config() -> None:
    """autoscale subcommand maps flags to AutoscaleConfig defaults."""
    parser = _build_parser()
    args = parser.parse_args(["autoscale", "--app", "myapp:queue"])
    assert args.command == "autoscale"
    assert args.app == "myapp:queue"
    assert args.min_workers == 1
    assert args.max_workers == 10
    assert args.target_queue_depth == 15
    assert args.target_utilisation == 0.75
    assert args.scale_up_window == 0
    assert args.scale_down_window == 300
    assert args.tolerance == 0.1
    assert args.poll_interval == 5
    assert args.drain_timeout == 30
    assert args.threads_per_worker == 4


def test_autoscale_custom_flags() -> None:
    """autoscale subcommand accepts all custom flags."""
    parser = _build_parser()
    args = parser.parse_args(
        [
            "autoscale",
            "--app",
            "myapp:queue",
            "--min-workers",
            "2",
            "--max-workers",
            "20",
            "--target-queue-depth",
            "25",
            "--target-utilisation",
            "0.8",
            "--scale-up-window",
            "30",
            "--scale-down-window",
            "600",
            "--tolerance",
            "0.2",
            "--poll-interval",
            "10",
            "--drain-timeout",
            "60",
            "--threads-per-worker",
            "8",
        ]
    )
    assert args.min_workers == 2
    assert args.max_workers == 20
    assert args.target_queue_depth == 25
    assert args.target_utilisation == 0.8
    assert args.scale_up_window == 30
    assert args.scale_down_window == 600
    assert args.tolerance == 0.2
    assert args.poll_interval == 10
    assert args.drain_timeout == 60
    assert args.threads_per_worker == 8
