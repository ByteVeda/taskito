"""Tests for CLI info command."""

import pytest

from taskito.cli import _load_queue, _print_stats


def test_load_queue_invalid_format():
    """_load_queue rejects paths without a colon."""
    with pytest.raises(SystemExit):
        _load_queue("no_colon_here")


def test_load_queue_missing_module():
    """_load_queue exits on missing module."""
    with pytest.raises(SystemExit):
        _load_queue("nonexistent.module:queue")


def test_print_stats_format(capsys, tmp_path):
    """_print_stats prints a formatted stats table."""
    from taskito import Queue

    db_path = str(tmp_path / "test_cli_stats.db")
    queue = Queue(db_path=db_path)

    @queue.task()
    def noop():
        pass

    noop.delay()
    noop.delay()

    _print_stats(queue)
    output = capsys.readouterr().out

    assert "taskito queue statistics" in output
    assert "pending" in output
    assert "total" in output
