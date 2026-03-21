"""taskito — Rust-powered task queue for Python. No broker required."""

from taskito.app import Queue
from taskito.canvas import Signature, chain, chord, chunks, group, starmap
from taskito.context import current_job
from taskito.events import EventType
from taskito.exceptions import (
    CircuitBreakerOpenError,
    CircularDependencyError,
    JobNotFoundError,
    MaxRetriesExceededError,
    ProxyCleanupError,
    ProxyReconstructionError,
    QueueError,
    RateLimitExceededError,
    ResourceError,
    ResourceInitError,
    ResourceNotFoundError,
    ResourceUnavailableError,
    SerializationError,
    SoftTimeoutError,
    TaskCancelledError,
    TaskFailedError,
    TaskitoError,
    TaskTimeoutError,
)
from taskito.inject import Inject
from taskito.interception import InterceptionError, InterceptionReport
from taskito.middleware import TaskMiddleware
from taskito.proxies.no_proxy import NoProxy
from taskito.result import JobResult
from taskito.serializers import (
    CloudpickleSerializer,
    EncryptedSerializer,
    JsonSerializer,
    MsgPackSerializer,
    Serializer,
)
from taskito.task import TaskWrapper
from taskito.testing import MockResource, TestMode, TestResult, TestResults

__all__ = [
    "CircuitBreakerOpenError",
    "CircularDependencyError",
    "CloudpickleSerializer",
    "EncryptedSerializer",
    "EventType",
    "Inject",
    "InterceptionError",
    "InterceptionReport",
    "JobNotFoundError",
    "JobResult",
    "JsonSerializer",
    "MaxRetriesExceededError",
    "MockResource",
    "MsgPackSerializer",
    "NoProxy",
    "ProxyCleanupError",
    "ProxyReconstructionError",
    "Queue",
    "QueueError",
    "RateLimitExceededError",
    "ResourceError",
    "ResourceInitError",
    "ResourceNotFoundError",
    "ResourceUnavailableError",
    "SerializationError",
    "Serializer",
    "Signature",
    "SoftTimeoutError",
    "TaskCancelledError",
    "TaskFailedError",
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
# PyResultSender is only available when built with --features native-async.
# Expose it with a clean error instead of a confusing AttributeError.
try:
    from taskito._taskito import PyResultSender  # noqa: F401

    __all__.append("PyResultSender")
except (ImportError, AttributeError):
    pass

try:
    from importlib.metadata import PackageNotFoundError
    from importlib.metadata import version as _get_version

    __version__ = _get_version("taskito")
except PackageNotFoundError:
    __version__ = "0.7.0"
