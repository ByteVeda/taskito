"""Task chaining primitives: Signature, chain, group, chord."""

from __future__ import annotations

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
        """Enqueue this signature for execution.

        Args:
            queue: Queue instance to enqueue on. ``None`` uses the
                queue from the wrapped task.

        Returns:
            A :class:`~taskito.result.JobResult` handle.
        """
        q = queue or self.task._queue
        return q.enqueue(
            task_name=self.task.name,
            args=self.args,
            kwargs=self.kwargs if self.kwargs else None,
            **self.options,
        )


class chain:
    """Execute signatures sequentially, piping each result to the next.

    Usage::

        result = chain(add.s(2, 3), multiply.s(10)).apply(queue)
        print(result.result(timeout=30))  # (2 + 3) * 10 = 50
    """

    def __init__(self, *signatures: Signature):
        """Create a chain from one or more signatures.

        Args:
            *signatures: Signatures to execute in order. Each mutable
                signature receives the previous task's return value as
                its first argument.

        Raises:
            ValueError: If no signatures are provided.
        """
        if len(signatures) < 1:
            raise ValueError("chain requires at least one signature")
        self.signatures = list(signatures)

    def apply(self, queue: Queue | None = None) -> JobResult:
        """Execute the chain, blocking until all steps complete.

        Each signature is enqueued and waited on sequentially. For mutable
        signatures, the previous result is prepended to the arguments.

        Args:
            queue: Queue instance to enqueue on. ``None`` uses the
                queue from the first signature's task.

        Returns:
            The :class:`~taskito.result.JobResult` of the **last** step.

        Raises:
            RuntimeError: If any step in the chain fails.
            TimeoutError: If any step exceeds the 300-second internal timeout.
        """
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

    Usage::

        results = group(add.s(1, 2), add.s(3, 4)).apply(queue)
        print([r.result(timeout=30) for r in results])  # [3, 7]
    """

    def __init__(self, *signatures: Signature):
        """Create a group from one or more signatures.

        Args:
            *signatures: Signatures to execute in parallel.

        Raises:
            ValueError: If no signatures are provided.
        """
        if len(signatures) < 1:
            raise ValueError("group requires at least one signature")
        self.signatures = list(signatures)

    def apply(self, queue: Queue | None = None) -> list[JobResult]:
        """Enqueue all signatures for parallel execution.

        All jobs are enqueued immediately and execute concurrently.

        Args:
            queue: Queue instance to enqueue on. ``None`` uses the
                queue from the first signature's task.

        Returns:
            List of :class:`~taskito.result.JobResult` handles, one per
            signature, in the same order.
        """
        q = queue or self.signatures[0].task._queue

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


class chord:
    """Run a group in parallel, then a callback with all results.

    Usage::

        result = chord(
            group(add.s(1, 2), add.s(3, 4)),
            total.s()
        ).apply(queue)
        print(result.result(timeout=30))  # sum([3, 7]) = 10
    """

    def __init__(self, group_: group, callback: Signature):
        """Create a chord from a group and a callback signature.

        Args:
            group_: A :class:`group` whose results are collected.
            callback: A :class:`Signature` invoked with the collected
                results as its first argument (unless immutable).
        """
        self.group = group_
        self.callback = callback

    def apply(self, queue: Queue | None = None) -> JobResult:
        """Execute the group, wait for all results, then run the callback.

        The callback receives a list of all group results as its first
        positional argument (for mutable signatures).

        Args:
            queue: Queue instance to enqueue on. ``None`` uses the
                queue from the callback's task.

        Returns:
            The :class:`~taskito.result.JobResult` of the callback task.

        Raises:
            RuntimeError: If any job in the group fails.
            TimeoutError: If any group job exceeds the 300-second internal
                timeout.
        """
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
