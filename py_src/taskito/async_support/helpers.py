"""Helpers for running potentially-async callables from sync contexts."""

from __future__ import annotations

import asyncio
from typing import Any


def run_maybe_async(result: Any) -> Any:
    """If *result* is a coroutine, run it to completion and return the value.

    Safe to call from any thread that does **not** already have a running
    event loop (worker threads, main thread, daemon threads).
    """
    if asyncio.iscoroutine(result):
        return asyncio.run(result)
    return result
