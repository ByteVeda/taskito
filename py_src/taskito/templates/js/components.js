// ── Shared HTML builders ──────────────────────────────

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
