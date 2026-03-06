"""Custom exception hierarchy for taskito."""


class TaskitoError(Exception):
    """Base exception for all taskito errors."""


class TaskTimeoutError(TaskitoError):
    """Raised when a task exceeds its hard timeout."""


class SoftTimeoutError(TaskitoError):
    """Raised when a task exceeds its soft timeout (checked via context)."""


class TaskCancelledError(TaskitoError):
    """Raised when a running task detects it has been cancelled."""


class MaxRetriesExceededError(TaskitoError):
    """Raised when a task has exhausted all retry attempts."""


class SerializationError(TaskitoError):
    """Raised on serialization or deserialization failures."""


class CircuitBreakerOpenError(TaskitoError):
    """Raised when a task's circuit breaker is open."""


class RateLimitExceededError(TaskitoError):
    """Raised when a task's rate limit is exceeded."""


class JobNotFoundError(TaskitoError, KeyError):
    """Raised when a job ID is not found in storage."""


class QueueError(TaskitoError):
    """Raised on queue-level operational errors."""
