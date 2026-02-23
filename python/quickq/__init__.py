"""quickq — Rust-powered task queue for Python. No broker required."""

from quickq.app import Queue
from quickq.canvas import Signature, chain, chord, group
from quickq.context import current_job
from quickq.result import JobResult
from quickq.task import TaskWrapper

__all__ = [
    "JobResult",
    "Queue",
    "Signature",
    "TaskWrapper",
    "chain",
    "chord",
    "current_job",
    "group",
]
__version__ = "0.1.0"
