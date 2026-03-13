// ── Throughput chart ──────────────────────────────────

function drawThroughputChart() {
  const canvas = document.getElementById('throughput-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  const w = rect.width, h = rect.height;

  const data = S.throughputHistory;
  if (data.length < 2) {
    ctx.fillStyle = 'rgba(160,160,176,0.5)';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Collecting data...', w / 2, h / 2);
    return;
  }

  const max = Math.max(...data, 1);
  const pad = { top: 10, right: 10, bottom: 20, left: 40 };
  const cw = w - pad.left - pad.right;
  const ch = h - pad.top - pad.bottom;

  // Grid lines
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + ch * (1 - i / 4);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();
    ctx.fillStyle = 'rgba(160,160,176,0.5)';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText((max * i / 4).toFixed(1), pad.left - 4, y + 3);
  }

  // Area fill
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top + ch);
  data.forEach((v, i) => {
    const x = pad.left + (i / (data.length - 1)) * cw;
    const y = pad.top + ch * (1 - v / max);
    ctx.lineTo(x, y);
  });
  ctx.lineTo(pad.left + cw, pad.top + ch);
  ctx.closePath();
  ctx.fillStyle = 'rgba(102, 187, 106, 0.15)';
  ctx.fill();

  // Line
  ctx.beginPath();
  data.forEach((v, i) => {
    const x = pad.left + (i / (data.length - 1)) * cw;
    const y = pad.top + ch * (1 - v / max);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.strokeStyle = '#66bb6a';
  ctx.lineWidth = 2;
  ctx.stroke();
}

// ── DAG rendering ─────────────────────────────────────

async function renderJobDag(jobId) {
  const dag = await api(`/api/jobs/${jobId}/dag`);
  if (!dag.nodes || dag.nodes.length <= 1) return '';

  const nodeW = 160, nodeH = 36, gapX = 40, gapY = 20;
  const nodeMap = {};
  dag.nodes.forEach((n, i) => { nodeMap[n.id] = i; });

  // BFS layer assignment
  const adj = {};
  const inDeg = {};
  dag.nodes.forEach(n => { adj[n.id] = []; inDeg[n.id] = 0; });
  dag.edges.forEach(e => {
    adj[e.from] = adj[e.from] || [];
    adj[e.from].push(e.to);
    inDeg[e.to] = (inDeg[e.to] || 0) + 1;
  });

  const layers = [];
  const placed = new Set();
  let queue = dag.nodes.filter(n => (inDeg[n.id] || 0) === 0).map(n => n.id);
  while (queue.length) {
    layers.push([...queue]);
    queue.forEach(id => placed.add(id));
    const next = [];
    queue.forEach(id => {
      (adj[id] || []).forEach(to => {
        if (!placed.has(to) && !next.includes(to)) next.push(to);
      });
    });
    queue = next;
  }
  dag.nodes.forEach(n => { if (!placed.has(n.id)) { layers.push([n.id]); placed.add(n.id); } });

  const positions = {};
  let svgW = 0, svgH = 0;
  layers.forEach((layer, li) => {
    layer.forEach((id, ni) => {
      const x = 20 + li * (nodeW + gapX);
      const y = 20 + ni * (nodeH + gapY);
      positions[id] = { x, y };
      svgW = Math.max(svgW, x + nodeW + 20);
      svgH = Math.max(svgH, y + nodeH + 20);
    });
  });

  const statusColors = {
    pending: '#ffa726', running: '#42a5f5', complete: '#66bb6a',
    failed: '#ef5350', dead: '#ef5350', cancelled: '#a0a0b0'
  };

  let edgesSvg = dag.edges.map(e => {
    const from = positions[e.from], to = positions[e.to];
    if (!from || !to) return '';
    return `<line class="dag-edge" x1="${from.x + nodeW}" y1="${from.y + nodeH / 2}" x2="${to.x}" y2="${to.y + nodeH / 2}"/>`;
  }).join('');

  let nodesSvg = dag.nodes.map(n => {
    const p = positions[n.id];
    if (!p) return '';
    const fill = statusColors[n.status] || '#a0a0b0';
    return `
      <g class="dag-node" onclick="location.hash='#/jobs/${n.id}'">
        <rect x="${p.x}" y="${p.y}" width="${nodeW}" height="${nodeH}" fill="rgba(${fill === '#66bb6a' ? '102,187,106' : fill === '#ef5350' ? '239,83,80' : fill === '#42a5f5' ? '66,165,245' : fill === '#ffa726' ? '255,167,38' : '160,160,176'},0.2)" stroke="${fill}" stroke-width="1.5"/>
        <text x="${p.x + 8}" y="${p.y + 14}" fill="${fill}" font-size="10" font-weight="600">${n.status.toUpperCase()}</text>
        <text x="${p.x + 8}" y="${p.y + 28}" font-size="10" fill="var(--fg2)">${escHtml(n.task_name.length > 18 ? n.task_name.slice(-18) : n.task_name)}</text>
      </g>`;
  }).join('');

  return `
  <div class="dag-container" style="margin-top:16px">
    <h3 style="margin-bottom:8px; font-size:14px;">Dependency Graph</h3>
    <div class="chart-container" style="overflow-x:auto">
      <svg width="${svgW}" height="${svgH}">
        <defs><marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--fg2)"/></marker></defs>
        ${edgesSvg}
        ${nodesSvg}
      </svg>
    </div>
  </div>`;
}
