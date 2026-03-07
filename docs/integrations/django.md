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

## Configuration

Create a `taskito` queue configuration in your Django settings or a dedicated module. The `get_queue()` function in `taskito.contrib.django.settings` is used to retrieve the queue instance.

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
