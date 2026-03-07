"""Django AppConfig for taskito."""

from __future__ import annotations

try:
    from django.apps import AppConfig
except ImportError as e:
    raise ImportError(
        "Django integration requires 'django'. Install with: pip install taskito[django]"
    ) from e


class TaskitoConfig(AppConfig):
    """Django application configuration for taskito."""

    name = "taskito.contrib.django"
    verbose_name = "Taskito"
    default_auto_field = "django.db.models.BigAutoField"

    def ready(self) -> None:
        """Auto-discover ``tasks.py`` modules in all installed apps."""
        from django.utils.module_loading import autodiscover_modules

        autodiscover_modules("tasks")
