// ── Overview ──────────────────────────────────────────

async function renderOverview() {
  S.stats = await api('/api/stats');

  const completed = S.stats.completed || 0;
  if (S.prevCompleted > 0) {
    S.throughput = ((completed - S.prevCompleted) / (S.refreshMs / 1000)).toFixed(1);
  }
  S.prevCompleted = completed;

  S.throughputHistory.push(parseFloat(S.throughput) || 0);
  if (S.throughputHistory.length > 60) S.throughputHistory.shift();

  const recent = await api('/api/jobs?limit=10');

  $app().innerHTML = `
  ${statsHTML(S.stats)}
  <div class="chart-container">
    <h3>Throughput (jobs/s)</h3>
    <canvas id="throughput-chart" height="160"></canvas>
  </div>
  <h3 style="margin-bottom:12px; font-size:14px; color:var(--fg2);">Recent Jobs</h3>
  ${jobTableHTML(recent, false)}
`;
  drawThroughputChart();
}

// ── Jobs ──────────────────────────────────────────────

async function renderJobs() {
  S.stats = await api('/api/stats');

  let url = `/api/jobs?limit=${S.pageSize}&offset=${S.page * S.pageSize}`;
  if (S.filter.status) url += `&status=${S.filter.status}`;
  if (S.filter.queue) url += `&queue=${encodeURIComponent(S.filter.queue)}`;
  if (S.filter.task) url += `&task=${encodeURIComponent(S.filter.task)}`;
  if (S.filter.metadata) url += `&metadata=${encodeURIComponent(S.filter.metadata)}`;
  if (S.filter.error) url += `&error=${encodeURIComponent(S.filter.error)}`;
  if (S.filter.created_after) url += `&created_after=${new Date(S.filter.created_after).getTime()}`;
  if (S.filter.created_before) url += `&created_before=${new Date(S.filter.created_before).getTime()}`;

  S.jobs = await api(url);

  $app().innerHTML = `
  ${statsHTML(S.stats)}
  <div class="filters">
    <select id="f-status">
      <option value="">All statuses</option>
      <option value="pending" ${S.filter.status === 'pending' ? 'selected' : ''}>Pending</option>
      <option value="running" ${S.filter.status === 'running' ? 'selected' : ''}>Running</option>
      <option value="complete" ${S.filter.status === 'complete' ? 'selected' : ''}>Complete</option>
      <option value="failed" ${S.filter.status === 'failed' ? 'selected' : ''}>Failed</option>
      <option value="dead" ${S.filter.status === 'dead' ? 'selected' : ''}>Dead</option>
      <option value="cancelled" ${S.filter.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
    </select>
    <input id="f-queue" placeholder="Queue name..." value="${S.filter.queue}">
    <input id="f-task" placeholder="Task name..." value="${S.filter.task}">
    <input id="f-metadata" placeholder="Metadata search..." value="${S.filter.metadata}">
    <input id="f-error" placeholder="Error text..." value="${S.filter.error}">
    <input id="f-after" type="date" title="Created after" value="${S.filter.created_after}">
    <input id="f-before" type="date" title="Created before" value="${S.filter.created_before}">
  </div>
  ${jobTableHTML(S.jobs, true)}
`;

  const bindFilter = (sel, key) => {
    const el = $(sel);
    if (el) el.onchange = (e) => { S.filter[key] = e.target.value; S.page = 0; renderJobs(); };
  };
  bindFilter('#f-status', 'status');
  bindFilter('#f-queue', 'queue');
  bindFilter('#f-task', 'task');
  bindFilter('#f-metadata', 'metadata');
  bindFilter('#f-error', 'error');
  bindFilter('#f-after', 'created_after');
  bindFilter('#f-before', 'created_before');
}

// ── Job Detail ────────────────────────────────────────

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
    <button class="btn" onclick="replayJob('${job.id}')">Replay</button>
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

  ${await renderJobLogs(id)}
  ${await renderReplayHistory(id)}
  ${await renderJobDag(id)}

  <div style="margin-top:16px">
    <a href="#/jobs">&larr; Back to jobs</a>
  </div>
`;
}

async function renderJobLogs(jobId) {
  const logs = await api(`/api/jobs/${jobId}/logs`);
  if (!logs.length) return '';
  return `
  <div style="margin-top:16px">
    <h3 style="margin-bottom:8px; font-size:14px;">Task Logs (${logs.length})</h3>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Time</th><th>Level</th><th>Message</th><th>Extra</th></tr></thead>
        <tbody>
          ${logs.map(l => `
          <tr>
            <td>${fmtTime(l.logged_at)}</td>
            <td><span class="badge ${l.level === 'error' ? 'failed' : l.level === 'warning' ? 'pending' : 'complete'}">${l.level}</span></td>
            <td>${escHtml(l.message)}</td>
            <td style="max-width:200px; overflow:hidden; text-overflow:ellipsis;">${escHtml(l.extra || '')}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  </div>`;
}

async function renderReplayHistory(jobId) {
  const history = await api(`/api/jobs/${jobId}/replay-history`);
  if (!history.length) return '';
  return `
  <div style="margin-top:16px">
    <h3 style="margin-bottom:8px; font-size:14px;">Replay History (${history.length})</h3>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Replay Job</th><th>Replayed At</th><th>Original Error</th><th>Replay Error</th></tr></thead>
        <tbody>
          ${history.map(h => `
          <tr>
            <td class="id-cell"><a href="#/jobs/${h.replay_job_id}">${escHtml(h.replay_job_id.slice(0, 8))}</a></td>
            <td>${fmtTime(h.replayed_at)}</td>
            <td style="max-width:200px; overflow:hidden; text-overflow:ellipsis;">${escHtml(h.original_error || '—')}</td>
            <td style="max-width:200px; overflow:hidden; text-overflow:ellipsis;">${escHtml(h.replay_error || '—')}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  </div>`;
}

// ── Dead Letters ──────────────────────────────────────

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

// ── Metrics ───────────────────────────────────────────

async function renderMetrics() {
  const metrics = await api('/api/metrics');
  const tasks = Object.keys(metrics);

  if (!tasks.length) {
    $app().innerHTML = '<h2 style="margin-bottom:16px; font-size:16px;">Task Metrics</h2><div class="empty">No metrics yet. Run some tasks first.</div>';
    return;
  }

  let rows = tasks.map(t => {
    const m = metrics[t];
    return `<tr>
    <td>${escHtml(t)}</td>
    <td>${m.count}</td>
    <td style="color:var(--green)">${m.success_count}</td>
    <td style="color:var(--red)">${m.failure_count}</td>
    <td>${m.avg_ms}ms</td>
    <td>${m.p50_ms}ms</td>
    <td>${m.p95_ms}ms</td>
    <td>${m.p99_ms}ms</td>
    <td>${m.min_ms}ms</td>
    <td>${m.max_ms}ms</td>
  </tr>`;
  }).join('');

  $app().innerHTML = `
  <h2 style="margin-bottom:16px; font-size:16px;">Task Metrics <span style="color:var(--fg2); font-size:12px;">(last hour)</span></h2>
  <div class="table-wrap">
    <table>
      <thead><tr>
        <th>Task</th><th>Total</th><th>Success</th><th>Failures</th><th>Avg</th><th>P50</th><th>P95</th><th>P99</th><th>Min</th><th>Max</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
`;
}

// ── Logs ──────────────────────────────────────────────

async function renderLogs() {
  const logs = await api('/api/logs?limit=100');

  $app().innerHTML = `
  <h2 style="margin-bottom:16px; font-size:16px;">Task Logs <span style="color:var(--fg2); font-size:12px;">(last hour)</span></h2>
  ${!logs.length ? '<div class="empty">No logs yet.</div>' : `
  <div class="table-wrap">
    <table>
      <thead><tr>
        <th>Time</th><th>Level</th><th>Task</th><th>Job</th><th>Message</th><th>Extra</th>
      </tr></thead>
      <tbody>
        ${logs.map(l => `
        <tr>
          <td>${fmtTime(l.logged_at)}</td>
          <td><span class="badge ${l.level === 'error' ? 'failed' : l.level === 'warning' ? 'pending' : 'complete'}">${l.level}</span></td>
          <td>${escHtml(l.task_name)}</td>
          <td class="id-cell"><a href="#/jobs/${l.job_id}">${escHtml(l.job_id.slice(0, 8))}</a></td>
          <td>${escHtml(l.message)}</td>
          <td style="max-width:200px; overflow:hidden; text-overflow:ellipsis;" title="${escAttr(l.extra)}">${escHtml(l.extra || '')}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>`}
`;
}

// ── Circuit Breakers ──────────────────────────────────

async function renderCircuitBreakers() {
  const breakers = await api('/api/circuit-breakers');

  $app().innerHTML = `
  <h2 style="margin-bottom:16px; font-size:16px;">Circuit Breakers</h2>
  ${!breakers.length ? '<div class="empty">No circuit breakers configured.</div>' : `
  <div class="table-wrap">
    <table>
      <thead><tr>
        <th>Task</th><th>State</th><th>Failures</th><th>Threshold</th><th>Window</th><th>Cooldown</th><th>Last Failure</th>
      </tr></thead>
      <tbody>
        ${breakers.map(b => `
        <tr>
          <td>${escHtml(b.task_name)}</td>
          <td><span class="badge ${b.state === 'open' ? 'failed' : b.state === 'half_open' ? 'pending' : 'complete'}">${b.state}</span></td>
          <td>${b.failure_count}</td>
          <td>${b.threshold}</td>
          <td>${(b.window_ms / 1000).toFixed(0)}s</td>
          <td>${(b.cooldown_ms / 1000).toFixed(0)}s</td>
          <td>${b.last_failure_at ? fmtTime(b.last_failure_at) : '—'}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>`}
`;
}

// ── Workers ───────────────────────────────────────────

async function renderWorkers() {
  const workers = await api('/api/workers');
  const stats = await api('/api/stats');
  const running = stats.running || 0;

  $app().innerHTML = `
  <h2 style="margin-bottom:16px; font-size:16px;">Workers</h2>
  ${!workers.length ? '<div class="empty">No active workers.</div>' : `
  <div style="margin-bottom:16px; font-size:13px; color:var(--fg2);">
    Active workers: <span style="color:var(--fg)">${workers.length}</span>
    &nbsp;&middot;&nbsp; Running jobs: <span style="color:var(--blue)">${running}</span>
  </div>
  <div class="worker-grid">
    ${workers.map(w => `
    <div class="worker-card">
      <div class="worker-id">${escHtml(w.worker_id)}</div>
      <div class="worker-meta">
        Queues: <span>${escHtml(w.queues)}</span><br>
        Last heartbeat: <span>${fmtTime(w.last_heartbeat)}</span><br>
        Registered: <span>${fmtTime(w.registered_at)}</span>
        ${w.tags ? `<br>Tags: <span>${escHtml(w.tags)}</span>` : ''}
      </div>
    </div>`).join('')}
  </div>`}
`;
}
