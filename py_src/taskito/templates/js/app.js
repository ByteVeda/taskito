// ── State ──────────────────────────────────────────────
const S = {
  stats: {},
  jobs: [],
  deadLetters: [],
  jobDetail: null,
  jobErrors: [],
  filter: { status: '', queue: '', task: '', metadata: '', error: '', created_after: '', created_before: '' },
  page: 0,
  pageSize: 20,
  prevCompleted: 0,
  throughput: 0,
  throughputHistory: [],
  refreshTimer: null,
  refreshMs: 5000,
};

const $ = (sel) => document.querySelector(sel);
const $app = () => $('#app');

// ── API ────────────────────────────────────────────────
async function api(path) {
  const res = await fetch(path);
  return res.json();
}

async function apiPost(path) {
  const res = await fetch(path, { method: 'POST' });
  return res.json();
}

// ── Routing ────────────────────────────────────────────
function route() {
  const hash = location.hash || '#/';
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
  } else if (hash === '#/metrics') {
    $('#nav-metrics').classList.add('active');
    renderMetrics();
  } else if (hash === '#/logs') {
    $('#nav-logs').classList.add('active');
    renderLogs();
  } else if (hash === '#/workers') {
    $('#nav-workers').classList.add('active');
    renderWorkers();
  } else if (hash === '#/circuit-breakers') {
    $('#nav-cb').classList.add('active');
    renderCircuitBreakers();
  } else if (hash === '#/dead-letters') {
    $('#nav-dead').classList.add('active');
    S.page = 0;
    renderDeadLetters();
  } else {
    $('#nav-home').classList.add('active');
    renderOverview();
  }
}

// ── Auto-refresh ──────────────────────────────────────
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

// ── Boot ──────────────────────────────────────────────
window.addEventListener('hashchange', route);
route();
startRefresh();
