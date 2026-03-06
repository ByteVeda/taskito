"""Task chaining primitives: Signature, chain, group, chord, chunks, starmap."""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from taskito.app import Queue
    from taskito.result import JobResult
    from taskito.task import TaskWrapper


@dataclass(frozen=True)
class Signature:
    """A frozen task call spec — what to call and with what arguments.

    Created via ``task.s()`` or ``task.si()``::

        sig = add.s(2, 3)          # mutable — receives previous result
        sig = add.si(2, 3)         # immutable — ignores previous result
    """

    task: TaskWrapper
    args: tuple = ()
    kwargs: dict = field(default_factory=dict)
    options: dict = field(default_factory=dict)
    immutable: bool = False

    def apply(self, queue: Queue | None = None) -> JobResult:
        """Enqueue this signature for execution."""
        q = queue or self.task._queue
        return q.enqueue(
            task_name=self.task.name,
            args=self.args,
            kwargs=self.kwargs if self.kwargs else None,
            **self.options,
        )


class chain:
    """Execute signatures sequentially, piping each result to the next."""

    def __init__(self, *signatures: Signature):
        if len(signatures) < 1:
            raise ValueError("chain requires at least one signature")
        self.signatures = list(signatures)

    def apply(self, queue: Queue | None = None) -> JobResult:
        """Execute the chain, blocking until all steps complete."""
        q = queue or self.signatures[0].task._queue

        prev_result: Any = None
        last_job: JobResult | None = None

        for sig in self.signatures:
            args = sig.args
            if prev_result is not None and not sig.immutable:
                args = (prev_result, *sig.args)

            last_job = q.enqueue(
                task_name=sig.task.name,
                args=args,
                kwargs=sig.kwargs if sig.kwargs else None,
                **sig.options,
            )
            prev_result = last_job.result(timeout=300)

        return last_job  # type: ignore[return-value]


class group:
    """Execute signatures in parallel and collect all results.

    Args:
        *signatures: Signatures to execute in parallel.
        max_concurrency: If set, limits how many group members run
            concurrently. Members are dispatched in waves.
    """

    def __init__(
        self, *signatures: Signature, max_concurrency: int | None = None
    ):
        if len(signatures) < 1:
            raise ValueError("group requires at least one signature")
        self.signatures = list(signatures)
        self.max_concurrency = max_concurrency

    def apply(self, queue: Queue | None = None) -> list[JobResult]:
        """Enqueue all signatures for parallel execution."""
        q = queue or self.signatures[0].task._queue

        if self.max_concurrency is None:
            # No concurrency limit — enqueue all at once
            jobs: list[JobResult] = []
            for sig in self.signatures:
                job = q.enqueue(
                    task_name=sig.task.name,
                    args=sig.args,
                    kwargs=sig.kwargs if sig.kwargs else None,
                    **sig.options,
                )
                jobs.append(job)
            return jobs

        # With concurrency limit — dispatch in waves
        all_jobs: list[JobResult] = []
        mc = self.max_concurrency
        for i in range(0, len(self.signatures), mc):
            wave = self.signatures[i : i + mc]
            wave_jobs: list[JobResult] = []
            for sig in wave:
                job = q.enqueue(
                    task_name=sig.task.name,
                    args=sig.args,
                    kwargs=sig.kwargs if sig.kwargs else None,
                    **sig.options,
                )
                wave_jobs.append(job)
            # Wait for this wave to complete before starting next
            for job in wave_jobs:
                job.result(timeout=300)
            all_jobs.extend(wave_jobs)

        return all_jobs


class chord:
    """Run a group in parallel, then a callback with all results."""

    def __init__(self, group_: group, callback: Signature):
        self.group = group_
        self.callback = callback

    def apply(self, queue: Queue | None = None) -> JobResult:
        """Execute the group, wait for all results, then run the callback."""
        q = queue or self.callback.task._queue

        # Run group and wait for all results
        jobs = self.group.apply(queue=q)
        results = [job.result(timeout=300) for job in jobs]

        # Run callback with collected results
        args = self.callback.args
        if not self.callback.immutable:
            args = (results, *self.callback.args)

        return q.enqueue(
            task_name=self.callback.task.name,
            args=args,
            kwargs=self.callback.kwargs if self.callback.kwargs else None,
            **self.callback.options,
        )


def chunks(
    task: TaskWrapper, items: list[Any], chunk_size: int
) -> group:
    """Split items into chunks and create a group of tasks processing each chunk.

    Args:
        task: The task to call for each chunk.
        items: List of items to split.
        chunk_size: Number of items per chunk.

    Returns:
        A :class:`group` of signatures, one per chunk.

    Example::

        result = chunks(process_batch, items, 100).apply(queue)
    """
    n_chunks = math.ceil(len(items) / chunk_size)
    sigs = []
    for i in range(n_chunks):
        chunk = items[i * chunk_size : (i + 1) * chunk_size]
        sigs.append(task.s(chunk))
    return group(*sigs)


def starmap(
    task: TaskWrapper, args_list: list[tuple[Any, ...]]
) -> group:
    """Create a group with one task per args tuple.

    Args:
        task: The task to call for each args tuple.
        args_list: List of argument tuples.

    Returns:
        A :class:`group` of signatures, one per args tuple.

    Example::

        result = starmap(add, [(1, 2), (3, 4), (5, 6)]).apply(queue)
    """
    sigs = [task.s(*args) for args in args_list]
    return group(*sigs)
