"""quickq — Rust-powered task queue for Python. No broker required."""

from quickq.app import Queue
from quickq.result import JobResult
from quickq.task import TaskWrapper

__all__ = ["JobResult", "Queue", "TaskWrapper"]
__version__ = "0.1.0"
