"""Built-in web dashboard for taskito — zero extra dependencies.

Usage::

    taskito dashboard --app myapp:queue
    # → http://127.0.0.1:8080

Or programmatically::

    from taskito.dashboard import serve_dashboard
    serve_dashboard(queue, host="0.0.0.0", port=8080)
"""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import TYPE_CHECKING, Any
from urllib.parse import parse_qs, urlparse

if TYPE_CHECKING:
    from taskito.app import Queue


def serve_dashboard(
    queue: Queue,
    host: str = "127.0.0.1",
    port: int = 8080,
) -> None:
    """Start the dashboard HTTP server (blocking).

    Args:
        queue: The Queue instance to monitor.
        host: Bind address.
        port: Bind port.
    """

    handler = _make_handler(queue)
    server = ThreadingHTTPServer((host, port), handler)
    print(f"taskito dashboard → http://{host}:{port}")
    print("Press Ctrl+C to stop")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


def _make_handler(queue: Queue) -> type:
    """Create a request handler class bound to the given queue."""

    class DashboardHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            parsed = urlparse(self.path)
            path = parsed.path
            qs = parse_qs(parsed.query)

            if path == "/api/stats":
                self._json_response(queue.stats())
            elif path == "/api/jobs":
                self._handle_list_jobs(qs)
            elif path.startswith("/api/jobs/") and path.endswith("/errors"):
                job_id = path[len("/api/jobs/") : -len("/errors")]
                self._json_response(queue.job_errors(job_id))
            elif path.startswith("/api/jobs/"):
                job_id = path[len("/api/jobs/") :]
                job = queue.get_job(job_id)
                if job is None:
                    self._json_response({"error": "Job not found"}, status=404)
                else:
                    self._json_response(job.to_dict())
            elif path == "/api/dead-letters":
                limit = int(qs.get("limit", ["20"])[0])
                offset = int(qs.get("offset", ["0"])[0])
                self._json_response(queue.dead_letters(limit=limit, offset=offset))
            else:
                self._serve_spa()

        def do_POST(self) -> None:
            parsed = urlparse(self.path)
            path = parsed.path

            if path.startswith("/api/jobs/") and path.endswith("/cancel"):
                job_id = path[len("/api/jobs/") : -len("/cancel")]
                ok = queue.cancel_job(job_id)
                self._json_response({"cancelled": ok})
            elif path.startswith("/api/dead-letters/") and path.endswith("/retry"):
                dead_id = path[len("/api/dead-letters/") : -len("/retry")]
                new_id = queue.retry_dead(dead_id)
                self._json_response({"new_job_id": new_id})
            elif path == "/api/dead-letters/purge":
                count = queue.purge_dead(0)
                self._json_response({"purged": count})
            else:
                self._json_response({"error": "Not found"}, status=404)

        def _handle_list_jobs(self, qs: dict) -> None:
            status = qs.get("status", [None])[0]
            q = qs.get("queue", [None])[0]
            task = qs.get("task", [None])[0]
            limit = int(qs.get("limit", ["20"])[0])
            offset = int(qs.get("offset", ["0"])[0])

            jobs = queue.list_jobs(
                status=status,
                queue=q,
                task_name=task,
                limit=limit,
                offset=offset,
            )
            self._json_response([j.to_dict() for j in jobs])

        def _json_response(self, data: Any, status: int = 200) -> None:
            body = json.dumps(data, default=str).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)

        def _serve_spa(self) -> None:
            body = _SPA_HTML.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format: str, *args: Any) -> None:
            # Suppress default access log noise
            pass

    return DashboardHandler


# ---------------------------------------------------------------------------
# Embedded SPA — HTML + CSS + JS in a single string
# ---------------------------------------------------------------------------

_SPA_HTML = """\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>taskito dashboard</title>
<style>
:root {
  --bg: #1a1a2e;
  --bg2: #16213e;
  --bg3: #0f3460;
  --fg: #e0e0e0;
  --fg2: #a0a0b0;
  --accent: #7c4dff;
  --accent2: #b388ff;
  --green: #66bb6a;
  --yellow: #ffa726;
  --red: #ef5350;
  --blue: #42a5f5;
  --cyan: #26c6da;
  --radius: 8px;
  --shadow: 0 2px 8px rgba(0,0,0,0.3);
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: var(--bg);
  color: var(--fg);
  min-height: 100vh;
}

a { color: var(--accent2); text-decoration: none; }
a:hover { text-decoration: underline; }

/* ── Header ──────────────────────────────── */
header {
  background: var(--bg2);
  border-bottom: 1px solid var(--bg3);
  padding: 12px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

header h1 {
  font-size: 18px;
  font-weight: 600;
  color: var(--accent2);
}

header h1 span { color: var(--fg2); font-weight: 400; }

nav { display: flex; gap: 16px; }

nav a {
  color: var(--fg2);
  font-size: 14px;
  padding: 4px 8px;
  border-radius: 4px;
  transition: all 0.15s;
}
nav a:hover, nav a.active {
  color: var(--fg);
  background: var(--bg3);
  text-decoration: none;
}

.refresh-ctl {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--fg2);
}

.refresh-ctl select {
  background: var(--bg3);
  color: var(--fg);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 12px;
}

/* ── Main ────────────────────────────────── */
main { max-width: 1200px; margin: 0 auto; padding: 24px; }

/* ── Stats cards ─────────────────────────── */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
  margin-bottom: 24px;
}

.stat-card {
  background: var(--bg2);
  border-radius: var(--radius);
  padding: 16px;
  box-shadow: var(--shadow);
  text-align: center;
}

.stat-card .value {
  font-size: 28px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.stat-card .label {
  font-size: 12px;
  color: var(--fg2);
  text-transform: uppercase;
  margin-top: 4px;
}

.stat-card.pending .value { color: var(--yellow); }
.stat-card.running .value { color: var(--blue); }
.stat-card.completed .value { color: var(--green); }
.stat-card.failed .value { color: var(--red); }
.stat-card.dead .value { color: var(--red); }
.stat-card.cancelled .value { color: var(--fg2); }

/* ── Filters ─────────────────────────────── */
.filters {
  display: flex;
  gap: 10px;
  margin-bottom: 16px;
  flex-wrap: wrap;
  align-items: center;
}

.filters select, .filters input {
  background: var(--bg2);
  color: var(--fg);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 4px;
  padding: 6px 10px;
  font-size: 13px;
}

.filters input { width: 180px; }

/* ── Table ───────────────────────────────── */
.table-wrap {
  background: var(--bg2);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  overflow: hidden;
}

table { width: 100%; border-collapse: collapse; font-size: 13px; }

thead th {
  text-align: left;
  padding: 10px 12px;
  background: var(--bg3);
  color: var(--fg2);
  font-weight: 600;
  font-size: 11px;
  text-transform: uppercase;
  white-space: nowrap;
}

tbody td {
  padding: 8px 12px;
  border-top: 1px solid rgba(255,255,255,0.04);
  white-space: nowrap;
}

tbody tr:hover { background: rgba(124,77,255,0.06); }

.id-cell {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 12px;
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── Status badges ───────────────────────── */
.badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
}
.badge.pending    { background: rgba(255,167,38,0.15); color: var(--yellow); }
.badge.running    { background: rgba(66,165,245,0.15); color: var(--blue); }
.badge.complete   { background: rgba(102,187,106,0.15); color: var(--green); }
.badge.failed     { background: rgba(239,83,80,0.15); color: var(--red); }
.badge.dead       { background: rgba(239,83,80,0.25); color: var(--red); }
.badge.cancelled  { background: rgba(160,160,176,0.15); color: var(--fg2); }

/* ── Progress bar ────────────────────────── */
.progress-bar {
  width: 60px;
  height: 6px;
  background: rgba(255,255,255,0.08);
  border-radius: 3px;
  overflow: hidden;
  display: inline-block;
  vertical-align: middle;
}
.progress-bar .fill {
  height: 100%;
  background: var(--accent);
  border-radius: 3px;
  transition: width 0.3s;
}

/* ── Pagination ──────────────────────────── */
.pagination {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  font-size: 13px;
  color: var(--fg2);
}

.pagination button {
  background: var(--bg3);
  color: var(--fg);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 4px;
  padding: 6px 14px;
  cursor: pointer;
  font-size: 13px;
}
.pagination button:disabled { opacity: 0.4; cursor: default; }
.pagination button:hover:not(:disabled) { background: var(--accent); }

/* ── Job detail panel ────────────────────── */
.detail-panel {
  background: var(--bg2);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 20px;
}
.detail-panel h2 { font-size: 16px; margin-bottom: 16px; }

.detail-grid {
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 8px 16px;
  font-size: 13px;
}
.detail-grid .label { color: var(--fg2); }
.detail-grid .value { font-family: 'JetBrains Mono', monospace; font-size: 12px; word-break: break-all; }

.btn {
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 4px;
  padding: 6px 16px;
  cursor: pointer;
  font-size: 13px;
  margin-top: 12px;
}
.btn:hover { opacity: 0.85; }
.btn.danger { background: var(--red); }

/* ── Error list ──────────────────────────── */
.error-list { margin-top: 16px; }
.error-item {
  background: rgba(239,83,80,0.08);
  border-left: 3px solid var(--red);
  padding: 10px 12px;
  margin-bottom: 8px;
  border-radius: 0 4px 4px 0;
  font-size: 13px;
}
.error-item .attempt { color: var(--fg2); font-size: 11px; }

/* ── Empty state ─────────────────────────── */
.empty {
  text-align: center;
  padding: 48px 0;
  color: var(--fg2);
  font-size: 14px;
}

/* ── Throughput ───────────────────────────── */
.throughput {
  font-size: 12px;
  color: var(--fg2);
  margin-bottom: 16px;
}
.throughput span { color: var(--green); font-weight: 600; }
</style>
</head>
<body>

<header>
  <h1>taskito <span>dashboard</span></h1>
  <nav>
    <a href="#/" id="nav-home">Overview</a>
    <a href="#/jobs" id="nav-jobs">Jobs</a>
    <a href="#/dead-letters" id="nav-dead">Dead Letters</a>
  </nav>
  <div class="refresh-ctl">
    <label>Refresh:</label>
    <select id="refresh-interval">
      <option value="2000">2s</option>
      <option value="5000" selected>5s</option>
      <option value="10000">10s</option>
      <option value="0">Off</option>
    </select>
  </div>
</header>

<main id="app"></main>

<script>
// ── State ────────────────────────────────────────────
const S = {
  stats: {},
  jobs: [],
  deadLetters: [],
  jobDetail: null,
  jobErrors: [],
  filter: { status: '', queue: '', task: '' },
  page: 0,
  pageSize: 20,
  prevCompleted: 0,
  throughput: 0,
  refreshTimer: null,
  refreshMs: 5000,
};

const $ = (sel) => document.querySelector(sel);
const $app = () => $('#app');

// ── API ──────────────────────────────────────────────
async function api(path) {
  const res = await fetch(path);
  return res.json();
}

async function apiPost(path) {
  const res = await fetch(path, { method: 'POST' });
  return res.json();
}

// ── Routing ──────────────────────────────────────────
function route() {
  const hash = location.hash || '#/';
  // Update nav active state
  document.querySelectorAll('nav a').forEach(a => a.classList.remove('active'));

  if (hash === '#/' || hash === '#') {
    $('#nav-home').classList.add('active');
    renderOverview();
  } else if (hash === '#/jobs') {
    $('#nav-jobs').classList.add('active');
    S.page = 0;
    renderJobs();
  } else if (hash.startsWith('#/jobs/')) {
    $('#nav-jobs').classList.add('active');
    const id = hash.slice(7);
    renderJobDetail(id);
  } else if (hash === '#/dead-letters') {
    $('#nav-dead').classList.add('active');
    S.page = 0;
    renderDeadLetters();
  } else {
    $('#nav-home').classList.add('active');
    renderOverview();
  }
}

// ── Renderers ────────────────────────────────────────

async function renderOverview() {
  S.stats = await api('/api/stats');

  const completed = S.stats.completed || 0;
  if (S.prevCompleted > 0) {
    S.throughput = ((completed - S.prevCompleted) / (S.refreshMs / 1000)).toFixed(1);
  }
  S.prevCompleted = completed;

  // Also fetch recent jobs
  const recent = await api('/api/jobs?limit=10');

  $app().innerHTML = `
    ${statsHTML(S.stats)}
    ${S.throughput > 0 ? `<div class="throughput">Throughput: <span>${S.throughput} jobs/s</span></div>` : ''}
    <h3 style="margin-bottom:12px; font-size:14px; color:var(--fg2);">Recent Jobs</h3>
    ${jobTableHTML(recent, false)}
  `;
}

async function renderJobs() {
  S.stats = await api('/api/stats');

  let url = `/api/jobs?limit=${S.pageSize}&offset=${S.page * S.pageSize}`;
  if (S.filter.status) url += `&status=${S.filter.status}`;
  if (S.filter.queue) url += `&queue=${encodeURIComponent(S.filter.queue)}`;
  if (S.filter.task) url += `&task=${encodeURIComponent(S.filter.task)}`;

  S.jobs = await api(url);

  $app().innerHTML = `
    ${statsHTML(S.stats)}
    <div class="filters">
      <select id="f-status">
        <option value="">All statuses</option>
        <option value="pending" ${S.filter.status==='pending'?'selected':''}>Pending</option>
        <option value="running" ${S.filter.status==='running'?'selected':''}>Running</option>
        <option value="complete" ${S.filter.status==='complete'?'selected':''}>Complete</option>
        <option value="failed" ${S.filter.status==='failed'?'selected':''}>Failed</option>
        <option value="dead" ${S.filter.status==='dead'?'selected':''}>Dead</option>
        <option value="cancelled" ${S.filter.status==='cancelled'?'selected':''}>Cancelled</option>
      </select>
      <input id="f-queue" placeholder="Queue name..." value="${S.filter.queue}">
      <input id="f-task" placeholder="Task name..." value="${S.filter.task}">
    </div>
    ${jobTableHTML(S.jobs, true)}
  `;

  // Bind filter events
  $('#f-status').onchange = (e) => { S.filter.status = e.target.value; S.page = 0; renderJobs(); };
  $('#f-queue').onchange = (e) => { S.filter.queue = e.target.value; S.page = 0; renderJobs(); };
  $('#f-task').onchange = (e) => { S.filter.task = e.target.value; S.page = 0; renderJobs(); };
}

async function renderJobDetail(id) {
  const job = await api(`/api/jobs/${id}`);
  if (job.error === 'Job not found') {
    $app().innerHTML = `<div class="empty">Job not found: ${escHtml(id)}</div>`;
    return;
  }

  const errors = await api(`/api/jobs/${id}/errors`);

  $app().innerHTML = `
    <div class="detail-panel">
      <h2>Job ${escHtml(id.slice(0, 8))}...</h2>
      <div class="detail-grid">
        <div class="label">ID</div><div class="value">${escHtml(job.id)}</div>
        <div class="label">Status</div><div class="value">${badgeHTML(job.status)}</div>
        <div class="label">Task</div><div class="value">${escHtml(job.task_name)}</div>
        <div class="label">Queue</div><div class="value">${escHtml(job.queue)}</div>
        <div class="label">Priority</div><div class="value">${job.priority}</div>
        <div class="label">Progress</div><div class="value">${progressHTML(job.progress)}</div>
        <div class="label">Retries</div><div class="value">${job.retry_count} / ${job.max_retries}</div>
        <div class="label">Created</div><div class="value">${fmtTime(job.created_at)}</div>
        <div class="label">Scheduled</div><div class="value">${fmtTime(job.scheduled_at)}</div>
        <div class="label">Started</div><div class="value">${job.started_at ? fmtTime(job.started_at) : '—'}</div>
        <div class="label">Completed</div><div class="value">${job.completed_at ? fmtTime(job.completed_at) : '—'}</div>
        <div class="label">Timeout</div><div class="value">${(job.timeout_ms / 1000).toFixed(0)}s</div>
        ${job.error ? `<div class="label">Error</div><div class="value" style="color:var(--red)">${escHtml(job.error)}</div>` : ''}
        ${job.unique_key ? `<div class="label">Unique Key</div><div class="value">${escHtml(job.unique_key)}</div>` : ''}
        ${job.metadata ? `<div class="label">Metadata</div><div class="value">${escHtml(job.metadata)}</div>` : ''}
      </div>
      ${job.status === 'pending' ? `<button class="btn danger" onclick="cancelJob('${job.id}')">Cancel Job</button>` : ''}
    </div>

    ${errors.length ? `
    <div class="error-list">
      <h3 style="margin:16px 0 8px; font-size:14px;">Error History (${errors.length})</h3>
      ${errors.map(e => `
        <div class="error-item">
          <div class="attempt">Attempt ${e.attempt} — ${fmtTime(e.failed_at)}</div>
          <div>${escHtml(e.error)}</div>
        </div>
      `).join('')}
    </div>` : ''}

    <div style="margin-top:16px">
      <a href="#/jobs">&larr; Back to jobs</a>
    </div>
  `;
}

async function renderDeadLetters() {
  S.deadLetters = await api(`/api/dead-letters?limit=${S.pageSize}&offset=${S.page * S.pageSize}`);

  $app().innerHTML = `
    <h2 style="margin-bottom:16px; font-size:16px;">Dead Letter Queue</h2>
    ${S.deadLetters.length === 0 ? '<div class="empty">No dead letters</div>' : `
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>ID</th><th>Original Job</th><th>Task</th><th>Queue</th><th>Error</th><th>Retries</th><th>Failed At</th><th>Actions</th>
        </tr></thead>
        <tbody>
          ${S.deadLetters.map(d => `
          <tr>
            <td class="id-cell">${escHtml(d.id.slice(0, 8))}</td>
            <td class="id-cell"><a href="#/jobs/${d.original_job_id}">${escHtml(d.original_job_id.slice(0, 8))}</a></td>
            <td>${escHtml(d.task_name)}</td>
            <td>${escHtml(d.queue)}</td>
            <td style="max-width:250px; overflow:hidden; text-overflow:ellipsis;" title="${escAttr(d.error)}">${escHtml(d.error || '—')}</td>
            <td>${d.retry_count}</td>
            <td>${fmtTime(d.failed_at)}</td>
            <td><button class="btn" onclick="retryDead('${d.id}')">Retry</button></td>
          </tr>
          `).join('')}
        </tbody>
      </table>
      <div class="pagination">
        <span>Page ${S.page + 1}</span>
        <div>
          <button onclick="deadPage(-1)" ${S.page === 0 ? 'disabled' : ''}>Prev</button>
          <button onclick="deadPage(1)" ${S.deadLetters.length < S.pageSize ? 'disabled' : ''}>Next</button>
        </div>
      </div>
    </div>`}
    ${S.deadLetters.length > 0 ? `<button class="btn danger" style="margin-top:12px" onclick="purgeAll()">Purge All Dead Letters</button>` : ''}
  `;
}

// ── Shared HTML builders ─────────────────────────────

function statsHTML(s) {
  const items = [
    ['pending', s.pending || 0],
    ['running', s.running || 0],
    ['completed', s.completed || 0],
    ['failed', s.failed || 0],
    ['dead', s.dead || 0],
    ['cancelled', s.cancelled || 0],
  ];
  return `<div class="stats-grid">${items.map(([k, v]) =>
    `<div class="stat-card ${k}"><div class="value">${v.toLocaleString()}</div><div class="label">${k}</div></div>`
  ).join('')}</div>`;
}

function jobTableHTML(jobs, paginate) {
  if (!jobs.length) return '<div class="empty">No jobs found</div>';
  return `
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>ID</th><th>Task</th><th>Queue</th><th>Status</th><th>Priority</th><th>Progress</th><th>Retries</th><th>Created</th>
        </tr></thead>
        <tbody>
          ${jobs.map(j => `
          <tr onclick="location.hash='#/jobs/${j.id}'" style="cursor:pointer">
            <td class="id-cell">${escHtml(j.id.slice(0, 8))}</td>
            <td>${escHtml(j.task_name)}</td>
            <td>${escHtml(j.queue)}</td>
            <td>${badgeHTML(j.status)}</td>
            <td>${j.priority}</td>
            <td>${progressHTML(j.progress)}</td>
            <td>${j.retry_count}/${j.max_retries}</td>
            <td>${fmtTime(j.created_at)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      ${paginate ? `
      <div class="pagination">
        <span>Page ${S.page + 1}</span>
        <div>
          <button onclick="jobPage(-1)" ${S.page === 0 ? 'disabled' : ''}>Prev</button>
          <button onclick="jobPage(1)" ${jobs.length < S.pageSize ? 'disabled' : ''}>Next</button>
        </div>
      </div>` : ''}
    </div>
  `;
}

function badgeHTML(status) {
  return `<span class="badge ${status}">${status}</span>`;
}

function progressHTML(progress) {
  if (progress == null) return '<span style="color:var(--fg2)">—</span>';
  return `<div class="progress-bar"><div class="fill" style="width:${progress}%"></div></div> ${progress}%`;
}

function fmtTime(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    + ' ' + d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function escHtml(s) {
  if (s == null) return '';
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}

function escAttr(s) {
  return escHtml(s).replace(/"/g, '&quot;');
}

// ── Actions ──────────────────────────────────────────

async function cancelJob(id) {
  await apiPost(`/api/jobs/${id}/cancel`);
  renderJobDetail(id);
}

async function retryDead(id) {
  await apiPost(`/api/dead-letters/${id}/retry`);
  renderDeadLetters();
}

async function purgeAll() {
  if (!confirm('Purge all dead letters?')) return;
  await apiPost('/api/dead-letters/purge');
  renderDeadLetters();
}

function jobPage(dir) {
  S.page = Math.max(0, S.page + dir);
  renderJobs();
}

function deadPage(dir) {
  S.page = Math.max(0, S.page + dir);
  renderDeadLetters();
}

// ── Auto-refresh ─────────────────────────────────────

function startRefresh() {
  stopRefresh();
  if (S.refreshMs > 0) {
    S.refreshTimer = setInterval(() => route(), S.refreshMs);
  }
}

function stopRefresh() {
  if (S.refreshTimer) {
    clearInterval(S.refreshTimer);
    S.refreshTimer = null;
  }
}

document.getElementById('refresh-interval').onchange = (e) => {
  S.refreshMs = parseInt(e.target.value);
  startRefresh();
};

// ── Boot ─────────────────────────────────────────────
window.addEventListener('hashchange', route);
route();
startRefresh();
</script>
</body>
</html>
"""
