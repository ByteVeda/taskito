// ── Actions ───────────────────────────────────────────

async function cancelJob(id) {
  await apiPost(`/api/jobs/${id}/cancel`);
  renderJobDetail(id);
}

async function replayJob(id) {
  const res = await apiPost(`/api/jobs/${id}/replay`);
  if (res.replay_job_id) {
    location.hash = `#/jobs/${res.replay_job_id}`;
  }
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
