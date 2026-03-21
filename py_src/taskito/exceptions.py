"""Custom exception hierarchy for taskito."""


class TaskitoError(Exception):
    """Base exception for all taskito errors."""


class TaskTimeoutError(TaskitoError):
    """Raised when a task exceeds its hard timeout."""


class SoftTimeoutError(TaskitoError):
    """Raised when a task exceeds its soft timeout (checked via context)."""


class TaskCancelledError(TaskitoError):
    """Raised when a running task detects it has been cancelled."""


class TaskFailedError(TaskitoError):
    """Raised when a task has failed."""


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


class ResourceError(TaskitoError):
    """Base exception for resource system errors."""


class ResourceInitError(ResourceError):
    """Raised when a resource factory fails during initialization."""


class ResourceUnavailableError(ResourceError):
    """Raised when a resource is permanently unhealthy and cannot be resolved."""


class CircularDependencyError(ResourceError):
    """Raised when resource dependencies form a cycle."""


class ResourceNotFoundError(ResourceError, KeyError):
    """Raised when resolving a resource name that was never registered."""


class ProxyReconstructionError(ResourceError):
    """Raised when a proxy handler fails to reconstruct an object from its recipe."""


class ProxyCleanupError(ResourceError):
    """Raised when a proxy handler fails during cleanup."""
