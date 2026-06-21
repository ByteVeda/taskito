/* ============================================================
   taskito · Demo 02 — Failure recovery (scrubbable timeline)
   Drag the playhead across one job's lifecycle. Toggle the
   ending: recover on the last retry, or exhaust into the DLQ.
   Tier-1: HTML + CSS + pointer events. No WebGL.
   ============================================================ */
(function(){
  var root=document.getElementById('fr-root');
  if(!root) return;

  var STATES={
    Queued:  {c:'var(--indigo-br)', soft:'var(--indigo-soft)', line:'var(--indigo-line)'},
    Running: {c:'var(--cyan)',  soft:'color-mix(in oklch,var(--cyan) 14%,transparent)', line:'color-mix(in oklch,var(--cyan) 40%,transparent)'},
    Failed:  {c:'var(--red)',   soft:'color-mix(in oklch,var(--red) 13%,transparent)',  line:'color-mix(in oklch,var(--red) 42%,transparent)'},
    Retrying:{c:'var(--amber)', soft:'color-mix(in oklch,var(--amber) 14%,transparent)',line:'color-mix(in oklch,var(--amber) 42%,transparent)'},
    Complete:{c:'var(--grn)',   soft:'color-mix(in oklch,var(--grn) 14%,transparent)',  line:'color-mix(in oklch,var(--grn) 42%,transparent)'},
    Dead:    {c:'var(--txt2)',  soft:'var(--panel3)', line:'var(--line3)'}
  };

  function base(){
    return [
      {t:0,    state:'Queued',  att:0, ttl:'Enqueued', d:'Accepted into the queue · status pending'},
      {t:800,  state:'Running', att:1, ttl:'Dispatched', d:'Worker picked up the job · attempt 1'},
      {t:2600, state:'Failed',  att:1, ttl:'Error', d:'ConnectionError: upstream returned 503'},
      {t:3000, state:'Retrying',att:1, ttl:'Backoff', d:'Waiting 2.0s before retry 2'},
      {t:5000, state:'Running', att:2, ttl:'Dispatched', d:'Worker picked up the job · attempt 2'},
      {t:6800, state:'Failed',  att:2, ttl:'Error', d:'ConnectionError: upstream returned 503'},
      {t:7200, state:'Retrying',att:2, ttl:'Backoff', d:'Waiting 4.0s before retry 3'},
      {t:11200,state:'Running', att:3, ttl:'Dispatched', d:'Worker picked up the job · attempt 3'}
    ];
  }
  var SCEN={
    recover: base().concat([
      {t:12700, state:'Complete', att:3, ttl:'Success', d:'Returned in 1.5s · result written to store'}
    ]),
    dlq: base().concat([
      {t:13000, state:'Failed', att:3, ttl:'Error', d:'ConnectionError: upstream returned 503'},
      {t:13300, state:'Dead',  att:3, ttl:'Dead-letter', d:'Max retries (3) exhausted → moved to DLQ'}
    ])
  };
  var TAIL=1400;

  root.innerHTML=
  '<div class="demo-bar">'+
    '<span class="title"><span class="ld"></span>job 01J8…f3 · lifecycle</span>'+
    '<div class="demo-controls">'+
      '<button class="ctl" id="fr-play"><svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M8 5v14l11-7z"/></svg>Play</button>'+
      '<div class="seg" id="fr-out" role="group" aria-label="Outcome">'+
        '<button data-v="recover" data-on="1" aria-pressed="true" class="good"><span class="dot"></span>Recovers</button>'+
        '<button data-v="dlq" data-on="0" aria-pressed="false" class="bad"><span class="dot"></span>Dead-letter</button>'+
      '</div>'+
    '</div>'+
  '</div>'+
  '<div class="fr-scrubwrap">'+
    '<div class="fr-track" id="fr-track" tabindex="0" role="slider" aria-label="Job timeline scrubber" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">'+
      '<div class="fr-rail" id="fr-rail"></div>'+
      '<div class="fr-fill" id="fr-fill"></div>'+
      '<div class="fr-handle" id="fr-handle"></div>'+
    '</div>'+
    '<div class="fr-axis"><span>0.0s</span><span id="fr-axmid"></span><span id="fr-axend"></span></div>'+
  '</div>'+
  '<div class="fr-grid">'+
    '<div class="fr-state">'+
      '<span class="fr-pill" id="fr-pill"><span class="pd"></span><span id="fr-pilltext">Queued</span></span>'+
      '<div class="big" id="fr-msg"></div>'+
      '<div class="fr-meta">'+
        '<div class="m"><span class="k">Elapsed</span><span class="v" id="fr-elapsed">0.0s</span></div>'+
        '<div class="m"><span class="k">Attempt</span><span class="v" id="fr-att">0 / 3</span></div>'+
        '<div class="m"><span class="k" id="fr-nxk">Next retry</span><span class="v" id="fr-nx">—</span></div>'+
      '</div>'+
      '<div><div class="k" style="font-family:var(--mono);font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--dim);margin-bottom:7px">Attempts</div>'+
      '<div class="fr-attempts" id="fr-attempts"></div></div>'+
    '</div>'+
    '<div class="fr-log" id="fr-log"></div>'+
  '</div>';

  var scen='recover', events=SCEN[scen], DUR=dur();
  function dur(){ return events[events.length-1].t+TAIL; }

  var track=el('fr-track'), rail=el('fr-rail'), fill=el('fr-fill'), handle=el('fr-handle');
  var elPill=el('fr-pill'), elPillT=el('fr-pilltext'), elMsg=el('fr-msg'),
      elElapsed=el('fr-elapsed'), elAtt=el('fr-att'), elNxK=el('fr-nxk'), elNx=el('fr-nx'),
      elAtts=el('fr-attempts'), elLog=el('fr-log');
  function el(id){return document.getElementById(id);}

  var play=0; // 0..DUR

  function buildRailSegments(){
    // colored segments + ticks
    [].slice.call(rail.querySelectorAll('.fr-seg')).forEach(function(n){n.remove();});
    [].slice.call(track.querySelectorAll('.fr-tick')).forEach(function(n){n.remove();});
    for(var i=0;i<events.length;i++){
      var a=events[i].t, b=(i+1<events.length)?events[i+1].t:DUR;
      var seg=document.createElement('div'); seg.className='fr-seg';
      seg.style.left=(a/DUR*100)+'%'; seg.style.width=((b-a)/DUR*100)+'%';
      seg.style.background='color-mix(in oklch,'+STATES[events[i].state].c+' 30%, transparent)';
      rail.appendChild(seg);
      if(i>0){
        var tk=document.createElement('div'); tk.className='fr-tick';
        tk.style.left=(a/DUR*100)+'%'; tk.style.background=STATES[events[i].state].c;
        track.appendChild(tk);
      }
    }
    el('fr-axmid').textContent=(DUR/2000).toFixed(1)+'s';
    el('fr-axend').textContent=(DUR/1000).toFixed(1)+'s';
  }

  function buildLog(){
    elLog.innerHTML=events.map(function(e,i){
      var st=STATES[e.state];
      return '<div class="fr-ev" data-i="'+i+'" style="--c:'+st.c+'">'+
        '<div class="dotcol"><span class="ed"></span><span class="eline"></span></div>'+
        '<div class="etxt"><span class="et">'+e.ttl+'</span><span class="ed2">'+e.d+'</span></div>'+
        '<span class="ets">'+(e.t/1000).toFixed(1)+'s</span>'+
      '</div>';
    }).join('');
  }

  function curIndex(){
    var idx=0;
    for(var i=0;i<events.length;i++){ if(events[i].t<=play+0.001) idx=i; else break; }
    return idx;
  }

  function render(){
    var pct=play/DUR*100;
    fill.style.width=pct+'%'; handle.style.left=pct+'%';
    track.setAttribute('aria-valuenow', Math.round(pct));
    var idx=curIndex(), ev=events[idx], st=STATES[ev.state];
    // pill
    elPillT.textContent=ev.state;
    elPill.style.color=st.c; elPill.style.background=st.soft; elPill.style.borderColor=st.line;
    elPill.querySelector('.pd').style.background=st.c;
    elMsg.innerHTML='<b>'+ev.ttl+'.</b> '+ev.d;
    elElapsed.textContent=(play/1000).toFixed(1)+'s';
    elAtt.textContent=ev.att+' / 3';
    // next retry countdown
    if(ev.state==='Retrying'){
      var nxt=(idx+1<events.length)?events[idx+1].t:DUR;
      elNxK.textContent='Next retry'; elNx.textContent=Math.max(0,(nxt-play)/1000).toFixed(1)+'s'; elNx.style.color='var(--amber)';
    } else if(ev.state==='Complete'){ elNxK.textContent='Result'; elNx.textContent='stored'; elNx.style.color='var(--grn)'; }
    else if(ev.state==='Dead'){ elNxK.textContent='Routed to'; elNx.textContent='DLQ'; elNx.style.color='var(--txt2)'; }
    else if(ev.state==='Running'){ elNxK.textContent='Worker'; elNx.textContent='busy'; elNx.style.color='var(--cyan)'; }
    else { elNxK.textContent='Next retry'; elNx.textContent='—'; elNx.style.color='var(--mut)'; }
    // attempts chips
    paintAttempts(idx);
    // log
    var evs=elLog.querySelectorAll('.fr-ev');
    evs.forEach(function(n,i){ n.classList.toggle('on', i<=idx); n.classList.toggle('cur', i===idx); });
    var curEl=evs[idx];
    if(curEl){ var top=curEl.offsetTop-elLog.clientHeight/2+curEl.clientHeight/2; elLog.scrollTop=Math.max(0,top); }
  }

  function paintAttempts(idx){
    // determine outcome of each attempt up to idx
    var res={1:'',2:'',3:''};
    for(var i=0;i<=idx;i++){
      var e=events[i];
      if(e.att>=1){
        if(e.state==='Running'&&!res[e.att]) res[e.att]='pending';
        if(e.state==='Failed') res[e.att]='fail';
        if(e.state==='Complete') res[e.att]='ok';
        if(e.state==='Dead') res[e.att]='dead';
      }
    }
    var html='';
    for(var a=1;a<=3;a++){
      var r=res[a], cls='', label=a;
      if(r==='ok'){cls='ok';label='✓';}
      else if(r==='fail'){cls='fail';label='✕';}
      else if(r==='dead'){cls='dead';label='☠';}
      else if(r==='pending'){cls='';}
      html+='<div class="a '+cls+'" title="attempt '+a+'">'+label+'</div>';
      if(a<3) html+='<span style="color:var(--dim);font-size:11px">›</span>';
    }
    elAtts.innerHTML=html;
  }

  // ---- scrub interaction ----
  var dragging=false;
  function setFromX(clientX){
    var r=track.getBoundingClientRect();
    var ratio=Math.max(0,Math.min(1,(clientX-r.left)/r.width));
    play=ratio*DUR; stopPlay(); render();
  }
  track.addEventListener('pointerdown',function(e){ dragging=true; track.setPointerCapture(e.pointerId); setFromX(e.clientX); });
  track.addEventListener('pointermove',function(e){ if(dragging) setFromX(e.clientX); });
  track.addEventListener('pointerup',function(){ dragging=false; });
  track.addEventListener('pointercancel',function(){ dragging=false; });
  track.addEventListener('keydown',function(e){
    var stepK=DUR/40;
    if(e.key==='ArrowRight'){ play=Math.min(DUR,play+stepK); stopPlay(); render(); e.preventDefault(); }
    else if(e.key==='ArrowLeft'){ play=Math.max(0,play-stepK); stopPlay(); render(); e.preventDefault(); }
    else if(e.key==='Home'){ play=0; stopPlay(); render(); e.preventDefault(); }
    else if(e.key==='End'){ play=DUR; stopPlay(); render(); e.preventDefault(); }
  });

  // ---- play ----
  var raf=null, lastT=0;
  function motionOff(){ return window.__motionOff || (window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches); }
  function tick(now){
    if(!lastT) lastT=now; var dt=now-lastT; lastT=now;
    play+=dt;
    if(play>=DUR){ play=DUR; render(); stopPlay(); return; }
    render(); raf=requestAnimationFrame(tick);
  }
  function startPlay(){
    if(motionOff()){ play=DUR; render(); return; }
    if(play>=DUR) play=0;
    lastT=0; setPlayBtn(true); raf=requestAnimationFrame(tick);
  }
  function stopPlay(){ if(raf){ cancelAnimationFrame(raf); raf=null; } setPlayBtn(false); }
  function setPlayBtn(on){
    var b=el('fr-play');
    b.innerHTML = on
      ? '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>Pause'
      : '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M8 5v14l11-7z"/></svg>Play';
  }
  el('fr-play').addEventListener('click',function(){ if(raf) stopPlay(); else startPlay(); });

  // ---- outcome toggle ----
  document.querySelectorAll('#fr-out button').forEach(function(b){
    b.addEventListener('click',function(){
      scen=b.getAttribute('data-v'); events=SCEN[scen]; DUR=dur();
      document.querySelectorAll('#fr-out button').forEach(function(x){ var on=x===b; x.setAttribute('data-on', on?'1':'0'); x.setAttribute('aria-pressed', on?'true':'false'); });
      play=Math.min(play,DUR);
      buildRailSegments(); buildLog(); render();
    });
  });

  window.__taskitoDemos=window.__taskitoDemos||{};
  var pm=window.__taskitoDemos.motion;
  window.__taskitoDemos.motion=function(off){ if(pm)pm(off); if(off) stopPlay(); };

  buildRailSegments(); buildLog(); render();
})();
