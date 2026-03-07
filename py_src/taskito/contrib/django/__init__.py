"""Django integration for taskito.

Add ``"taskito.contrib.django"`` to your ``INSTALLED_APPS`` and configure
via Django settings::

    INSTALLED_APPS = [
        ...
        "taskito.contrib.django",
    ]

    TASKITO_DB_PATH = ".taskito/taskito.db"
    TASKITO_BACKEND = "sqlite"       # or "postgres"
    TASKITO_DB_URL = None            # required for postgres
    TASKITO_WORKERS = 0              # 0 = auto-detect
    TASKITO_DEFAULT_RETRY = 3
    TASKITO_DEFAULT_TIMEOUT = 300
    TASKITO_DEFAULT_PRIORITY = 0
    TASKITO_RESULT_TTL = None        # seconds, or None to disable

Requires the ``django`` optional dependency::

    pip install taskito[django]
"""

default_app_config = "taskito.contrib.django.apps.TaskitoConfig"
