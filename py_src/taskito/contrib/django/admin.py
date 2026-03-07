"""Django admin views for taskito queue inspection.

Registers custom admin views for browsing jobs, dead letters, and queue stats.
Uses taskito's Python API directly — no Django ORM models needed.
"""

from __future__ import annotations

from typing import Any

try:
    from django.contrib import admin
    from django.http import HttpRequest, HttpResponse
    from django.template.response import TemplateResponse
    from django.urls import path
except ImportError as e:
    raise ImportError(
        "Django integration requires 'django'. "
        "Install with: pip install taskito[django]"
    ) from e


class TaskitoAdminSite(admin.AdminSite):
    """Custom admin site with taskito queue views."""

    site_header = "Taskito Admin"
    site_title = "Taskito"

    def get_urls(self) -> list:
        urls = super().get_urls()
        custom = [
            path("taskito/", self.admin_view(self.dashboard_view), name="taskito_dashboard"),
            path("taskito/jobs/", self.admin_view(self.jobs_view), name="taskito_jobs"),
            path(
                "taskito/jobs/<str:job_id>/",
                self.admin_view(self.job_detail_view),
                name="taskito_job_detail",
            ),
            path(
                "taskito/dead-letters/",
                self.admin_view(self.dead_letters_view),
                name="taskito_dead_letters",
            ),
        ]
        return custom + urls  # type: ignore[no-any-return]

    def dashboard_view(self, request: HttpRequest) -> HttpResponse:
        from taskito.contrib.django.settings import get_queue

        queue = get_queue()
        stats = queue.stats()
        context = {**self.each_context(request), "stats": stats, "title": "Taskito Dashboard"}
        return TemplateResponse(request, "taskito/admin/dashboard.html", context)

    def jobs_view(self, request: HttpRequest) -> HttpResponse:
        from taskito.contrib.django.settings import get_queue

        queue = get_queue()
        status = request.GET.get("status")
        queue_name = request.GET.get("queue")
        task_name = request.GET.get("task_name")
        page = int(request.GET.get("page", "1"))
        per_page = 50

        try:
            jobs = queue.list_jobs(
                status=status,
                queue=queue_name,
                task_name=task_name,
                limit=per_page,
                offset=(page - 1) * per_page,
            )
        except (ValueError, Exception):
            jobs = []
        context = {
            **self.each_context(request),
            "jobs": [j.to_dict() for j in jobs],
            "filters": {"status": status, "queue": queue_name, "task_name": task_name},
            "page": page,
            "title": "Taskito Jobs",
        }
        return TemplateResponse(request, "taskito/admin/jobs.html", context)

    def job_detail_view(self, request: HttpRequest, job_id: str) -> HttpResponse:
        from taskito.contrib.django.settings import get_queue

        queue = get_queue()
        job = queue.get_job(job_id)
        errors = queue.job_errors(job_id) if job else []
        context = {
            **self.each_context(request),
            "job": job.to_dict() if job else None,
            "errors": errors,
            "title": f"Job {job_id}",
        }
        return TemplateResponse(request, "taskito/admin/job_detail.html", context)

    def dead_letters_view(self, request: HttpRequest) -> HttpResponse:
        from taskito.contrib.django.settings import get_queue

        queue = get_queue()

        if request.method == "POST":
            action = request.POST.get("action")
            dead_id = request.POST.get("dead_id")
            if action == "retry" and dead_id:
                queue.retry_dead(dead_id)

        page = int(request.GET.get("page", "1"))
        per_page = 50
        dead = queue.dead_letters(limit=per_page, offset=(page - 1) * per_page)
        context = {
            **self.each_context(request),
            "dead_letters": dead,
            "page": page,
            "title": "Taskito Dead Letters",
        }
        return TemplateResponse(request, "taskito/admin/dead_letters.html", context)


def register_taskito_admin(site: Any = None) -> None:
    """Register taskito views on an existing admin site.

    Call this in your project's ``admin.py`` or ``urls.py``::

        from taskito.contrib.django.admin import register_taskito_admin
        register_taskito_admin()
    """
    target = site or admin.site

    def dashboard_view(request: HttpRequest) -> HttpResponse:
        from taskito.contrib.django.settings import get_queue

        queue = get_queue()
        stats = queue.stats()
        context = {**target.each_context(request), "stats": stats, "title": "Taskito Dashboard"}
        return TemplateResponse(request, "taskito/admin/dashboard.html", context)

    def jobs_view(request: HttpRequest) -> HttpResponse:
        from taskito.contrib.django.settings import get_queue

        queue = get_queue()
        status = request.GET.get("status")
        queue_name = request.GET.get("queue")
        task_name = request.GET.get("task_name")
        page = int(request.GET.get("page", "1"))
        per_page = 50
        try:
            jobs = queue.list_jobs(
                status=status,
                queue=queue_name,
                task_name=task_name,
                limit=per_page,
                offset=(page - 1) * per_page,
            )
        except (ValueError, Exception):
            jobs = []
        context = {
            **target.each_context(request),
            "jobs": [j.to_dict() for j in jobs],
            "filters": {"status": status, "queue": queue_name, "task_name": task_name},
            "page": page,
            "title": "Taskito Jobs",
        }
        return TemplateResponse(request, "taskito/admin/jobs.html", context)

    original_get_urls = target.get_urls

    def patched_get_urls() -> list:
        urls = original_get_urls()
        custom = [
            path("taskito/", target.admin_view(dashboard_view), name="taskito_dashboard"),
            path("taskito/jobs/", target.admin_view(jobs_view), name="taskito_jobs"),
        ]
        return custom + urls  # type: ignore[no-any-return]

    target.get_urls = patched_get_urls
