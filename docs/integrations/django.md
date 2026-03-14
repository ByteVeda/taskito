# Django Integration

taskito provides Django admin views for browsing jobs, inspecting dead letters, and viewing queue statistics — all without Django ORM models.

## Installation

```bash
pip install taskito[django]
```

## Setup

### Option 1: Register on the Default Admin Site

In your project's `admin.py` or `urls.py`:

```python
from taskito.contrib.django.admin import register_taskito_admin

register_taskito_admin()
```

This adds taskito views to the default `admin.site`.

### Option 2: Custom Admin Site

Use `TaskitoAdminSite` for a dedicated admin:

```python
from taskito.contrib.django.admin import TaskitoAdminSite

admin_site = TaskitoAdminSite(name="taskito_admin")
```

## Django Settings

The following settings can be defined in your Django `settings.py`:

| Setting | Default | Description |
|---------|---------|-------------|
| `TASKITO_AUTODISCOVER_MODULE` | `"tasks"` | Module name auto-discovered in each installed app on startup. |
| `TASKITO_ADMIN_PER_PAGE` | `50` | Rows per page in the admin jobs and dead letters views. |
| `TASKITO_ADMIN_TITLE` | `"Taskito"` | Browser tab title for `TaskitoAdminSite`. |
| `TASKITO_ADMIN_HEADER` | `"Taskito Admin"` | Site header shown in `TaskitoAdminSite`. |
| `TASKITO_WATCH_INTERVAL` | `2` | Polling interval in seconds for `manage.py taskito_info --watch`. |
| `TASKITO_DASHBOARD_HOST` | `"127.0.0.1"` | Default bind host for `manage.py taskito_dashboard`. |
| `TASKITO_DASHBOARD_PORT` | `8080` | Default bind port for `manage.py taskito_dashboard`. |

Example:

```python
# settings.py
TASKITO_AUTODISCOVER_MODULE = "jobs"   # import myapp.jobs instead of myapp.tasks
TASKITO_ADMIN_PER_PAGE = 25
TASKITO_ADMIN_TITLE = "MyApp Tasks"
TASKITO_ADMIN_HEADER = "MyApp Task Queue"
TASKITO_DASHBOARD_HOST = "0.0.0.0"
TASKITO_DASHBOARD_PORT = 9000
```

## Queue Configuration

Create a `taskito` queue instance in your Django project. The `get_queue()` function in `taskito.contrib.django.settings` is used to retrieve the queue instance.

```python
# myproject/tasks.py
from taskito import Queue

queue = Queue(db_path="taskito.db")

@queue.task()
def send_welcome_email(user_id: int):
    from myapp.models import User
    user = User.objects.get(id=user_id)
    user.email_user("Welcome!", "Thanks for signing up.")
```

!!! tip "Lazy imports"
    Import Django models inside the task function body to avoid app registry issues during startup.

## Admin Views

The integration provides the following views under `/admin/taskito/`:

- **Dashboard** — Queue statistics overview (pending, running, completed, failed, dead, cancelled)
- **Jobs** — Paginated job list with status, queue, and task name filters
- **Job Detail** — Full job payload, error history, retry count, and metadata
- **Dead Letters** — Browse and retry dead letter entries

## Running the Worker

```bash
DJANGO_SETTINGS_MODULE=myproject.settings taskito worker --app myproject.tasks:queue
```

## Full Example

### Project Structure

```
myproject/
  settings.py
  urls.py
  tasks.py          # Queue + task definitions
  myapp/
    admin.py         # Register taskito admin views
    views.py
    models.py
```

### `tasks.py`

```python
from taskito import Queue

queue = Queue(db_path="taskito.db")

@queue.task(max_retries=3)
def send_welcome_email(user_id: int):
    from myapp.models import User
    user = User.objects.get(id=user_id)
    user.email_user("Welcome!", "Thanks for signing up.")

@queue.task(rate_limit="60/h")
def generate_monthly_report(month: int, year: int):
    from myapp.reports import build_report
    return build_report(month, year)
```

### `myapp/admin.py`

```python
from django.contrib import admin
from taskito.contrib.django.admin import register_taskito_admin

register_taskito_admin()
```

### `myapp/views.py`

```python
from django.http import JsonResponse
from myproject.tasks import send_welcome_email

def signup_view(request):
    user = create_user(request.POST)
    send_welcome_email.delay(user.id)
    return JsonResponse({"status": "ok"})
```
