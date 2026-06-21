/* ============================================================
   taskito · Demo 04 — Workflow DAG execution
   A real dependency graph: chain → group (parallel) → chord
   (join) → fan-out. Run it and execution propagates as each
   task's inputs become ready; click a node to trace/run a branch.
   Tier-1: SVG + requestAnimationFrame. No WebGL.
   ============================================================ */
(function(){
  var root=document.getElementById('wf-root');
  if(!root) return;

  var W=760,H=372;
  // node model: center coords on the SVG canvas
  var NODES=[
    {id:'ingest',  label:'ingest',    fn:'fetch_source()',    type:'Source',     x:78,  y:186, dur:700},
    {id:'probe',   label:'probe',     fn:'inspect.s()',       type:'Chain step', x:222, y:186, dur:620},
    {id:'t720',    label:'transcode 720p', fn:'encode.s(720)',type:'Group · parallel', x:392, y:84,  dur:1500},
    {id:'t1080',   label:'transcode 1080p',fn:'encode.s(1080)',type:'Group · parallel',x:392, y:186, dur:2000},
    {id:'audio',   label:'extract audio',  fn:'audio.s()',    type:'Group · parallel', x:392, y:288, dur:1150},
    {id:'package', label:'package',   fn:'chord(mux.s())',    type:'Chord · join', x:560, y:186, dur:950},
    {id:'notify',  label:'notify',    fn:'webhook.s()',       type:'Fan-out',    x:704, y:120, dur:520},
    {id:'cdn',     label:'publish CDN',fn:'upload.s()',       type:'Fan-out',    x:704, y:252, dur:760}
  ];
  var EDGES=[
    ['ingest','probe'],
    ['probe','t720'],['probe','t1080'],['probe','audio'],
    ['t720','package'],['t1080','package'],['audio','package'],
    ['package','notify'],['package','cdn']
  ];
  var NW=120, NH=46;
  var byId={}; NODES.forEach(function(n){ byId[n.id]=n; n.deps=[]; n.kids=[]; });
  EDGES.forEach(function(e){ byId[e[1]].deps.push(e[0]); byId[e[0]].kids.push(e[1]); });

  // critical path (longest dur sum)
  (function(){
    var memo={};
    function cp(id){ if(memo[id]!=null) return memo[id]; var n=byId[id];
      var m=0; n.kids.forEach(function(k){ m=Math.max(m,cp(k)); }); return memo[id]=n.dur+m; }
    window.__wfCrit=Math.max.apply(null,NODES.filter(function(n){return n.deps.length===0;}).map(function(n){return cp(n.id);}));
  })();

  root.innerHTML=
  '<div class="demo-bar">'+
    '<span class="title"><span class="ld"></span>media-pipeline · DAG</span>'+
    '<div class="demo-controls">'+
      '<button class="ctl pri" id="wf-run"><svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M8 5v14l11-7z"/></svg>Run workflow</button>'+
      '<button class="ctl" id="wf-reset"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>Reset</button>'+
    '</div>'+
  '</div>'+
  '<div class="wf-grid">'+
    '<div class="wf-graph"><svg id="wf-svg" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Workflow dependency graph: ingest then probe, fanning out to three parallel transcode tasks, joined by a package step, then publishing to notify and CDN. Run animates execution in dependency order.">'+
      '<defs>'+
        '<marker id="wf-ar" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto"><path d="M1.5 1.5 L9 5 L1.5 8.5 Z" fill="var(--line3)"/></marker>'+
        '<marker id="wf-ar-on" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto"><path d="M1.5 1.5 L9 5 L1.5 8.5 Z" fill="var(--grn)"/></marker>'+
      '</defs>'+
      '<g id="wf-edges"></g><g id="wf-flow"></g><g id="wf-nodes"></g>'+
    '</svg></div>'+
    '<div class="wf-side" id="wf-side"></div>'+
  '</div>'+
  '<div class="legend">'+
    '<span><i style="background:var(--dim)"></i>idle</span>'+
    '<span><i style="background:var(--indigo-br)"></i>queued</span>'+
    '<span><i style="background:var(--cyan)"></i>running</span>'+
    '<span><i style="background:var(--grn)"></i>done</span>'+
  '</div>'+
  '<div class="readout">'+
    stat('tasks','wf-total')+stat('completed','wf-done','good')+stat('running','wf-running')+
    stat('elapsed','wf-elapsed',null,'s')+stat('critical path','wf-crit',null,'s')+
  '</div>';

  function stat(k,id,cls,u){ return '<div class="stat"><span class="k">'+k+'</span><span class="v'+(cls?' '+cls:'')+'" id="'+id+'">0'+(u?'<span class="u">'+u+'</span>':'')+'</span></div>'; }
  function g(id){ return document.getElementById(id); }

  var gEdges=g('wf-edges'), gFlow=g('wf-flow'), gNodes=g('wf-nodes'), side=g('wf-side');

  // ---- build edges ----
  var edgeEls={};
  EDGES.forEach(function(e){
    var a=byId[e[0]], b=byId[e[1]];
    var x1=a.x+NW/2, y1=a.y, x2=b.x-NW/2, y2=b.y;
    var mx=(x1+x2)/2;
    var d='M'+x1+' '+y1+' C '+mx+' '+y1+', '+mx+' '+y2+', '+x2+' '+y2;
    var base=document.createElementNS('http://www.w3.org/2000/svg','path');
    base.setAttribute('d',d); base.setAttribute('fill','none'); base.setAttribute('stroke','var(--line2)');
    base.setAttribute('stroke-width','2'); base.setAttribute('marker-end','url(#wf-ar)');
    gEdges.appendChild(base);
    var lit=document.createElementNS('http://www.w3.org/2000/svg','path');
    lit.setAttribute('d',d); lit.setAttribute('fill','none'); lit.setAttribute('stroke','var(--grn)');
    lit.setAttribute('stroke-width','2.4'); lit.setAttribute('stroke-linecap','round');
    var len=lit.getTotalLength?lit.getTotalLength():400;
    lit.style.strokeDasharray=len; lit.style.strokeDashoffset=len; lit.style.transition='stroke-dashoffset .5s ease';
    gFlow.appendChild(lit);
    edgeEls[e[0]+'>'+e[1]]={base:base,lit:lit,path:lit,len:len};
  });

  // ---- build nodes ----
  var nodeEls={};
  NODES.forEach(function(n){
    var grp=document.createElementNS('http://www.w3.org/2000/svg','g');
    grp.setAttribute('class','wf-node'); grp.setAttribute('tabindex','0'); grp.setAttribute('role','button');
    grp.setAttribute('aria-label',n.label+' — '+n.type);
    var rect=document.createElementNS('http://www.w3.org/2000/svg','rect');
    rect.setAttribute('x',n.x-NW/2); rect.setAttribute('y',n.y-NH/2); rect.setAttribute('width',NW); rect.setAttribute('height',NH);
    rect.setAttribute('rx','11'); rect.setAttribute('fill','var(--panel2)'); rect.setAttribute('stroke','var(--line2)');
    var pip=document.createElementNS('http://www.w3.org/2000/svg','circle');
    pip.setAttribute('cx',n.x+NW/2-14); pip.setAttribute('cy',n.y-NH/2+14); pip.setAttribute('r','4'); pip.setAttribute('fill','var(--dim)');
    var t1=document.createElementNS('http://www.w3.org/2000/svg','text');
    t1.setAttribute('x',n.x-NW/2+13); t1.setAttribute('y',n.y-3); t1.setAttribute('font-family','var(--sans)');
    t1.setAttribute('font-size','12.5'); t1.setAttribute('font-weight','600'); t1.setAttribute('fill','var(--txt2)'); t1.textContent=n.label;
    var t2=document.createElementNS('http://www.w3.org/2000/svg','text');
    t2.setAttribute('x',n.x-NW/2+13); t2.setAttribute('y',n.y+13); t2.setAttribute('font-family','var(--code)');
    t2.setAttribute('font-size','10'); t2.setAttribute('fill','var(--dim)'); t2.textContent=n.fn;
    grp.appendChild(rect); grp.appendChild(pip); grp.appendChild(t1); grp.appendChild(t2);
    gNodes.appendChild(grp);
    nodeEls[n.id]={g:grp,rect:rect,pip:pip,t1:t1,t2:t2};
    grp.addEventListener('click',function(){ selectNode(n.id); });
    grp.addEventListener('keydown',function(e){ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); selectNode(n.id); } });
  });

  // ---- state ----
  var state={}, started={}, finishAt={}, selected=null, runMask=null, t0=0, raf=null, running=false;
  function reset(full){
    // Clear any pending frame so `raf` never lingers as a stale "running" signal.
    if(raf){ cancelAnimationFrame(raf); raf=null; }
    NODES.forEach(function(n){ state[n.id]='idle'; started[n.id]=0; finishAt[n.id]=0; });
    runMask=null; running=false; t0=0;
    Object.keys(edgeEls).forEach(function(k){ edgeEls[k].lit.style.strokeDashoffset=edgeEls[k].len; edgeEls[k].base.setAttribute('marker-end','url(#wf-ar)'); });
    [].forEach.call(gFlow.querySelectorAll('circle.wf-dot'),function(d){ d.remove(); });
    NODES.forEach(paintNode);
    paintStats();
    if(full!==false){ selected=selected||'ingest'; renderSide(); }
  }

  var COLOR={
    idle:{fill:'var(--panel2)',stroke:'var(--line2)',pip:'var(--dim)',t1:'var(--txt2)'},
    queued:{fill:'var(--indigo-soft)',stroke:'var(--indigo-line)',pip:'var(--indigo-br)',t1:'var(--txt)'},
    running:{fill:'color-mix(in oklch,var(--cyan) 15%,transparent)',stroke:'color-mix(in oklch,var(--cyan) 55%,transparent)',pip:'var(--cyan)',t1:'var(--txt)'},
    done:{fill:'color-mix(in oklch,var(--grn) 13%,transparent)',stroke:'color-mix(in oklch,var(--grn) 48%,transparent)',pip:'var(--grn)',t1:'var(--txt)'}
  };
  function paintNode(n){
    var e=nodeEls[n.id], s=state[n.id], c=COLOR[s];
    e.rect.setAttribute('fill',c.fill); e.rect.setAttribute('stroke',selected===n.id?'var(--txt2)':c.stroke);
    e.rect.setAttribute('stroke-width',selected===n.id?'2.4':'1.6');
    e.pip.setAttribute('fill',c.pip);
    e.t1.setAttribute('fill',c.t1);
    // dim non-branch nodes when a node is selected & not running
    var dim = selected && !running && !inBranch(selected,n.id);
    e.g.style.opacity = dim ? '0.4' : '1';
  }
  function repaintAll(){ NODES.forEach(paintNode); }

  // downstream branch membership (selected node + all descendants)
  function inBranch(rootId,id){
    if(rootId===id) return true;
    var seen={}, stack=[rootId];
    while(stack.length){ var c=stack.pop(); byId[c].kids.forEach(function(k){ if(!seen[k]){ seen[k]=1; stack.push(k); } }); }
    return !!seen[id];
  }
  function branchSet(rootId){ var set={}; set[rootId]=1; var stack=[rootId];
    while(stack.length){ var c=stack.pop(); byId[c].kids.forEach(function(k){ if(!set[k]){ set[k]=1; stack.push(k); } }); }
    return set; }

  // ---- scheduler ----
  function start(mask){
    reset(false); runMask=mask||null; running=true; t0=performance.now();
    setRunBtn(true); repaintAll();
    if(motionOff()){ instantFinish(); return; }
    if(raf) cancelAnimationFrame(raf);
    raf=requestAnimationFrame(tick);
  }
  function eligible(id){
    if(runMask && !runMask[id]) return false;
    if(state[id]!=='idle') return false;
    return byId[id].deps.every(function(d){ return (runMask && !runMask[d]) ? true : state[d]==='done'; });
  }
  function tick(now){
    var t=now-t0;
    // launch eligible
    NODES.forEach(function(n){ if(eligible(n.id)){ state[n.id]='running'; started[n.id]=now; finishAt[n.id]=now+n.dur; paintNode(n); } });
    // finish
    NODES.forEach(function(n){ if(state[n.id]==='running' && now>=finishAt[n.id]){ state[n.id]='done'; paintNode(n); litOut(n); } });
    paintStats(t);
    var active=NODES.some(function(n){ return (runMask?runMask[n.id]:true) && state[n.id]!=='done' && state[n.id]!=='idle'; });
    var pending=NODES.some(function(n){ return eligible(n.id); });
    var anyRunning=NODES.some(function(n){ return state[n.id]==='running'; });
    if(anyRunning||pending){ raf=requestAnimationFrame(tick); }
    else { raf=null; running=false; setRunBtn(false); repaintAll(); renderSide(); }
  }
  function litOut(n){
    n.kids.forEach(function(k){
      if(runMask && !runMask[k]) return;
      var ed=edgeEls[n.id+'>'+k]; if(!ed) return;
      ed.lit.style.strokeDashoffset=0;
      ed.base.setAttribute('marker-end','url(#wf-ar-on)'); // arrowhead goes green with the edge
      if(!motionOff()) spawnDot(ed);
    });
  }
  function spawnDot(ed){
    var dot=document.createElementNS('http://www.w3.org/2000/svg','circle');
    dot.setAttribute('r','4'); dot.setAttribute('fill','var(--grn)'); dot.setAttribute('class','wf-dot');
    dot.style.filter='drop-shadow(0 0 5px var(--grn))';
    gFlow.appendChild(dot);
    var st=performance.now(), DUR=480, len=ed.len, path=ed.path;
    (function move(now){
      var p=Math.min(1,(now-st)/DUR);
      var pt=path.getPointAtLength(len*p);
      dot.setAttribute('cx',pt.x); dot.setAttribute('cy',pt.y);
      dot.style.opacity = p<0.12?(p/0.12):(p>0.85?(1-(p-0.85)/0.15):1);
      if(p<1) requestAnimationFrame(move); else dot.remove();
    })(st);
  }
  function instantFinish(){
    NODES.forEach(function(n){ if(!runMask||runMask[n.id]) state[n.id]='done'; });
    Object.keys(edgeEls).forEach(function(k){ var p=k.split('>'); if(!runMask||(runMask[p[0]]&&runMask[p[1]])){ edgeEls[k].lit.style.strokeDashoffset=0; edgeEls[k].base.setAttribute('marker-end','url(#wf-ar-on)'); } });
    running=false; setRunBtn(false); repaintAll(); paintStats(window.__wfCrit); renderSide();
  }

  function paintStats(t){
    var scope=NODES.filter(function(n){ return !runMask||runMask[n.id]; });
    var done=scope.filter(function(n){return state[n.id]==='done';}).length;
    var run=scope.filter(function(n){return state[n.id]==='running';}).length;
    setNum(g('wf-total'),scope.length);
    setNum(g('wf-done'),done);
    setNum(g('wf-running'),run);
    var el=g('wf-elapsed'); el.innerHTML=((t||0)/1000).toFixed(1)+'<span class="u">s</span>';
    var cr=g('wf-crit'); cr.innerHTML=(window.__wfCrit/1000).toFixed(1)+'<span class="u">s</span>';
  }
  function setNum(el,v){ el.childNodes.length>1?(el.childNodes[0].nodeValue=v):(el.textContent=v); }

  function setRunBtn(on){
    var b=g('wf-run');
    b.innerHTML = on
      ? '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>Running…'
      : '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M8 5v14l11-7z"/></svg>Run workflow';
    b.toggleAttribute('disabled',on);
  }

  // ---- side panel ----
  function selectNode(id){ selected=id; repaintAll(); renderSide(); }
  function renderSide(){
    var n=byId[selected||'ingest'];
    var deps=n.deps.length? n.deps.map(function(d){return '<span class="dc">'+byId[d].label+'</span>';}).join('')
                          : '<span class="dc none">none · root task</span>';
    var st=state[n.id]||'idle';
    var stColor={idle:'var(--dim)',queued:'var(--indigo-br)',running:'var(--cyan)',done:'var(--grn)'}[st];
    var downstream=Object.keys(branchSet(n.id)).length-1;
    side.innerHTML=
      '<span class="sk">selected task</span>'+
      '<span class="wf-seltype"><span style="width:7px;height:7px;border-radius:2px;background:currentColor;display:inline-block"></span>'+n.type+'</span>'+
      '<div class="wf-selname">'+n.label+'<span class="mono">'+n.fn+'</span></div>'+
      '<div class="wf-rows">'+
        '<div class="wf-row"><span class="k">Status</span><span class="wf-status"><span class="sd" style="background:'+stColor+'"></span>'+st+'</span></div>'+
        '<div class="wf-row"><span class="k">Depends on</span><div class="wf-depchips">'+deps+'</div></div>'+
        '<div class="wf-row"><span class="k">Est. duration</span><span class="v mono">'+(n.dur/1000).toFixed(2)+'s</span></div>'+
        '<div class="wf-row"><span class="k">Downstream tasks</span><span class="v mono">'+downstream+'</span></div>'+
      '</div>'+
      '<div class="wf-runbranch">'+
        '<button class="ctl" id="wf-branch"'+(downstream===0&&n.deps.length===0?'':'')+'><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3v12"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>Run from here</button>'+
        '<div class="note">'+(downstream>0?('runs this task + '+downstream+' downstream'):'runs just this task')+'</div>'+
      '</div>';
    g('wf-branch').addEventListener('click',function(){ start(branchSet(n.id)); });
  }

  // ---- controls / motion ----
  function motionOff(){ return window.__motionOff || (window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches); }
  g('wf-run').addEventListener('click',function(){ if(running) return; selected=null; start(null); });
  g('wf-reset').addEventListener('click',function(){ if(raf) cancelAnimationFrame(raf); reset(true); });

  window.__taskitoDemos=window.__taskitoDemos||{};
  var pm=window.__taskitoDemos.motion;
  window.__taskitoDemos.motion=function(off){ if(pm)pm(off); if(off && raf){ cancelAnimationFrame(raf); instantFinish(); } };

  // init
  reset(true);
  if(motionOff()){ instantFinish(); }
  else if(document.body.hasAttribute('data-embed')){ start(null); }
  else {
    var io=new IntersectionObserver(function(es){ es.forEach(function(e){ if(e.isIntersecting && t0===0){ start(null); io.disconnect(); } }); },{threshold:0.3});
    io.observe(root);
  }
})();
