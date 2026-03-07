"""taskito — Rust-powered task queue for Python. No broker required."""

from taskito.app import Queue
from taskito.canvas import Signature, chain, chord, chunks, group, starmap
from taskito.context import current_job
from taskito.events import EventType
from taskito.exceptions import (
    CircuitBreakerOpenError,
    JobNotFoundError,
    MaxRetriesExceededError,
    QueueError,
    RateLimitExceededError,
    SerializationError,
    SoftTimeoutError,
    TaskCancelledError,
    TaskitoError,
    TaskTimeoutError,
)
from taskito.middleware import TaskMiddleware
from taskito.result import JobResult
from taskito.serializers import (
    CloudpickleSerializer,
    EncryptedSerializer,
    JsonSerializer,
    MsgPackSerializer,
    Serializer,
)
from taskito.task import TaskWrapper
from taskito.testing import TestMode, TestResult, TestResults

__all__ = [
    "CircuitBreakerOpenError",
    "CloudpickleSerializer",
    "EncryptedSerializer",
    "EventType",
    "JobNotFoundError",
    "JobResult",
    "JsonSerializer",
    "MaxRetriesExceededError",
    "MsgPackSerializer",
    "Queue",
    "QueueError",
    "RateLimitExceededError",
    "SerializationError",
    "Serializer",
    "Signature",
    "SoftTimeoutError",
    "TaskCancelledError",
    "TaskMiddleware",
    "TaskTimeoutError",
    "TaskWrapper",
    "TaskitoError",
    "TestMode",
    "TestResult",
    "TestResults",
    "chain",
    "chord",
    "chunks",
    "current_job",
    "group",
    "starmap",
]
try:
    from importlib.metadata import version as _get_version

    __version__ = _get_version("taskito")
except Exception:
    __version__ = "0.2.3"
