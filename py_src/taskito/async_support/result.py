"""Async result polling for taskito job results."""

from __future__ import annotations

import asyncio
import time
from typing import TYPE_CHECKING, Any


class AsyncJobResultMixin:
    """Provides the async ``aresult()`` method for JobResult."""

    if TYPE_CHECKING:

        @property
        def id(self) -> str: ...
        def _poll_once(self) -> tuple[str, Any]: ...

    async def aresult(
        self,
        timeout: float = 30.0,
        poll_interval: float = 0.05,
        max_poll_interval: float = 0.5,
    ) -> Any:
        """Async version of :meth:`result`. Awaitable, non-blocking.

        Uses exponential backoff: starts polling at *poll_interval* and
        gradually increases to *max_poll_interval*.

        Args:
            timeout: Maximum seconds to wait.
            poll_interval: Initial seconds between status checks.
            max_poll_interval: Maximum seconds between status checks.

        Returns:
            The deserialized return value of the task function.

        Raises:
            TimeoutError: If the job doesn't complete within *timeout*.
            RuntimeError: If the job failed or was moved to DLQ.

        Example::

            result = await job.aresult(timeout=30)
        """
        if timeout <= 0:
            raise ValueError("timeout must be positive")
        deadline = time.monotonic() + timeout
        current_interval = poll_interval

        while True:
            status, value = self._poll_once()
            if status == "complete":
                return value
            if time.monotonic() >= deadline:
                raise TimeoutError(
                    f"Job {self.id} did not complete within {timeout}s (current status: {status})"
                )

            await asyncio.sleep(min(current_interval, max(0, deadline - time.monotonic())))
            current_interval = min(current_interval * 1.5, max_poll_interval)
