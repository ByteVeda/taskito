/* ============================================================
   taskito · Demo 06 — Saga / compensation
   A distributed transaction as a chain of steps, each with a
   compensating action. Pick where it fails and run it: forward
   steps commit, then on failure the compensations unwind in
   reverse so nothing is left half-done.
   Tier-1: SVG + requestAnimationFrame. No WebGL.
   ============================================================ */
(function(){
  var root=document.getElementById('saga-root');
  if(!root) return;

  var W=940,H=292, FDUR=720, CDUR=620;
  var STEPS=[
    {fwd:'reserve seat', f:'reserve_seat.s()', comp:'release seat', c:'release_seat.s()'},
    {fwd:'charge card',  f:'charge_card.s()',  comp:'refund card',  c:'refund_card.s()'},
    {fwd:'book hotel',   f:'book_hotel.s()',   comp:'cancel hotel', c:'cancel_hotel.s()'},
    {fwd:'issue ticket', f:'issue_ticket.s()', comp:'void ticket',  c:'void_ticket.s()'}
  ];
  var N=STEPS.length;
  var CX=[143,361,579,797], CYC=104, CW=178, CH=88;
  var SVGNS='http://www.w3.org/2000/svg';

  root.innerHTML=
  '<div class="demo-bar">'+
    '<span class="title"><span class="ld"></span>booking-saga · transaction</span>'+
    '<div class="demo-controls">'+
      '<div class="seg" id="saga-fail" role="group" aria-label="Where it fails">'+
        '<button data-v="1" class="bad" data-on="1" aria-pressed="true"><span class="dot"></span>charge fails</button>'+
        '<button data-v="2" class="bad" data-on="0" aria-pressed="false"><span class="dot"></span>hotel fails</button>'+
        '<button data-v="-1" class="good" data-on="0" aria-pressed="false"><span class="dot"></span>all succeed</button>'+
      '</div>'+
      '<button class="ctl pri" id="saga-run"><svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M8 5v14l11-7z"/></svg>Run saga</button>'+
      '<button class="ctl" id="saga-reset"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>Reset</button>'+
    '</div>'+
  '</div>'+
  '<div class="stage"><svg id="saga-svg" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="A booking saga: reserve seat, charge card, book hotel, issue ticket. Each step has a compensating action. When a step fails, taskito runs the compensations of the committed steps in reverse order.">'+
    '<g id="saga-edges"></g><g id="saga-cards"></g>'+
    '<g id="saga-tokenF"><circle r="6" fill="var(--cyan)" opacity="0" id="saga-dotF"/></g>'+
  '</svg></div>'+
  '<div class="legend">'+
    '<span><i style="background:var(--cyan)"></i>running</span>'+
    '<span><i style="background:var(--grn)"></i>committed</span>'+
    '<span><i style="background:var(--red)"></i>failed</span>'+
    '<span><i style="background:var(--amber)"></i>compensating</span>'+
    '<span><i style="background:var(--dim)"></i>undone</span>'+
  '</div>'+
  '<div class="readout">'+
    stat('step','saga-step')+stat('committed','saga-commit','good')+stat('compensated','saga-comp','warn')+
    stat('outcome','saga-outcome')+
  '</div>';

  function stat(k,id,cls){ return '<div class="stat"><span class="k">'+k+'</span><span class="v'+(cls?' '+cls:'')+'" id="'+id+'" style="font-size:16px">—</span></div>'; }
  function el(id){ return document.getElementById(id); }

  var gEdges=el('saga-edges'), gCards=el('saga-cards'), dotF=el('saga-dotF');

  // ---- forward + reverse edges ----
  var fEdges=[], rEdges=[];
  for(var i=0;i<N-1;i++){
    var x1=CX[i]+CW/2, x2=CX[i+1]-CW/2;
    var f=mkPath('M'+x1+' '+(CYC-6)+' H '+x2, 'var(--line2)', true, gEdges);
    fEdges.push(f);
    var r=mkPath('M'+x2+' '+(CYC+CH/2+30)+' H '+x1, 'color-mix(in oklch,var(--amber) 50%,transparent)', true, gEdges);
    r.setAttribute('opacity','0'); rEdges.push(r);
  }
  function mkPath(d,stroke,arrow,parent){
    var p=document.createElementNS(SVGNS,'path'); p.setAttribute('d',d); p.setAttribute('fill','none');
    p.setAttribute('stroke',stroke); p.setAttribute('stroke-width','2'); p.setAttribute('stroke-linecap','round');
    if(arrow){ p.setAttribute('marker-end','url(#saga-ar-'+(stroke.indexOf('amber')>=0?'c':'f')+')'); }
    parent.appendChild(p); return p;
  }
  // markers
  var defs=document.createElementNS(SVGNS,'defs');
  defs.innerHTML='<marker id="saga-ar-f" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M1 1 L9 5 L1 9" fill="none" stroke="var(--line3)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></marker>'+
    '<marker id="saga-ar-c" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M1 1 L9 5 L1 9" fill="none" stroke="var(--amber)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></marker>';
  el('saga-svg').insertBefore(defs, gEdges);

  // ---- cards ----
  var cards=[];
  STEPS.forEach(function(s,i){
    var cx=CX[i], x=cx-CW/2, y=CYC-CH/2;
    var g=document.createElementNS(SVGNS,'g');
    g.innerHTML=
      '<rect x="'+x+'" y="'+y+'" width="'+CW+'" height="'+CH+'" rx="13" fill="var(--panel2)" stroke="var(--line2)" data-rect/>'+
      '<text x="'+(x+15)+'" y="'+(y+22)+'" font-family="var(--mono)" font-size="9.5" letter-spacing=".06em" fill="var(--dim)">STEP '+(i+1)+'</text>'+
      '<circle cx="'+(x+CW-16)+'" cy="'+(y+18)+'" r="4.5" fill="var(--dim)" data-pip/>'+
      '<text x="'+(x+15)+'" y="'+(y+45)+'" font-family="var(--sans)" font-size="14.5" font-weight="600" fill="var(--txt2)" data-title>'+s.fwd+'</text>'+
      '<text x="'+(x+15)+'" y="'+(y+66)+'" font-family="var(--code)" font-size="11" fill="var(--mut)" data-fn>'+s.f+'</text>'+
      // compensation chip
      '<rect x="'+(x+18)+'" y="'+(CYC+CH/2+16)+'" width="'+(CW-36)+'" height="28" rx="8" fill="var(--panel)" stroke="var(--line2)" stroke-dasharray="3 4" data-crect/>'+
      '<path d="M'+(x+30)+' '+(CYC+CH/2+27)+' l-5 3 l5 3" fill="none" stroke="var(--dim)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" data-carrow/>'+
      '<text x="'+(x+40)+'" y="'+(CYC+CH/2+34)+'" font-family="var(--mono)" font-size="10.5" fill="var(--dim)" data-ctext>'+s.comp+'</text>';
    gCards.appendChild(g);
    cards.push({g:g, rect:g.querySelector('[data-rect]'), pip:g.querySelector('[data-pip]'),
      title:g.querySelector('[data-title]'), crect:g.querySelector('[data-crect]'),
      ctext:g.querySelector('[data-ctext]'), carrow:g.querySelector('[data-carrow]')});
  });

  // ---- state ----
  var st=[], failAt=1, phase='idle', raf=null, t0=0, idx=0, stepStart=0, compQueue=[], outcome='';
  function reset(){
    st=STEPS.map(function(){return 'pending';});
    phase='idle'; idx=0; compQueue=[]; outcome='';
    fEdges.forEach(function(e){ e.setAttribute('stroke','var(--line2)'); });
    rEdges.forEach(function(e){ e.setAttribute('opacity','0'); });
    dotF.setAttribute('opacity','0');
    cards.forEach(function(_,i){ paint(i); });
    setStats(); setRunBtn(false);
  }

  var COL={
    pending:{fill:'var(--panel2)',stroke:'var(--line2)',pip:'var(--dim)',t:'var(--txt2)'},
    running:{fill:'color-mix(in oklch,var(--cyan) 15%,transparent)',stroke:'color-mix(in oklch,var(--cyan) 52%,transparent)',pip:'var(--cyan)',t:'var(--txt)'},
    done:{fill:'color-mix(in oklch,var(--grn) 13%,transparent)',stroke:'color-mix(in oklch,var(--grn) 48%,transparent)',pip:'var(--grn)',t:'var(--txt)'},
    failed:{fill:'color-mix(in oklch,var(--red) 14%,transparent)',stroke:'color-mix(in oklch,var(--red) 52%,transparent)',pip:'var(--red)',t:'var(--txt)'},
    comp:{fill:'color-mix(in oklch,var(--amber) 15%,transparent)',stroke:'color-mix(in oklch,var(--amber) 52%,transparent)',pip:'var(--amber)',t:'var(--txt)'},
    undone:{fill:'var(--panel)',stroke:'var(--line2)',pip:'var(--dim)',t:'var(--dim)'}
  };
  function paint(i){
    var c=cards[i], s=st[i], k=COL[s];
    c.rect.setAttribute('fill',k.fill); c.rect.setAttribute('stroke',k.stroke);
    c.pip.setAttribute('fill',k.pip); c.title.setAttribute('fill',k.t);
    if(s==='undone'){ c.title.setAttribute('text-decoration','line-through'); } else { c.title.setAttribute('text-decoration','none'); }
    // compensation chip active during comp / undone
    var active = (s==='comp'||s==='undone');
    c.crect.setAttribute('stroke', s==='comp'?'color-mix(in oklch,var(--amber) 52%,transparent)':(s==='undone'?'var(--line3)':'var(--line2)'));
    c.crect.setAttribute('fill', s==='comp'?'color-mix(in oklch,var(--amber) 12%,transparent)':'var(--panel)');
    c.crect.setAttribute('stroke-dasharray', active?'':'3 4');
    c.ctext.setAttribute('fill', s==='comp'?'var(--amber)':(s==='undone'?'var(--txt2)':'var(--dim)'));
    c.carrow.setAttribute('stroke', s==='comp'?'var(--amber)':(s==='undone'?'var(--txt2)':'var(--dim)'));
  }

  function setStats(){
    var step = phase==='idle'?'—':(phase==='forward'?(idx+1)+' / '+N:(phase==='compensate'?'unwind':'done'));
    el('saga-step').textContent=step;
    el('saga-commit').textContent=st.filter(function(x){return x==='done';}).length;
    el('saga-comp').textContent=st.filter(function(x){return x==='undone';}).length;
    var o=el('saga-outcome');
    o.textContent = outcome || '—';
    o.className='v '+(outcome==='committed'?'good':(outcome==='rolled back'?'bad':''));
    o.style.fontSize='15px';
    o.textContent = outcome? (outcome==='committed'?'committed':'rolled back') : '—';
  }
  function setRunBtn(on){
    var b=el('saga-run');
    b.innerHTML= on? '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>Running…'
      : '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M8 5v14l11-7z"/></svg>Run saga';
    b.toggleAttribute('disabled',on);
  }

  // ---- run ----
  function motionOff(){ return window.__motionOff || (window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches); }
  function run(){
    reset(); phase='forward'; idx=0; setRunBtn(true);
    if(motionOff()){ instant(); return; }
    st[0]='running'; paint(0); stepStart=performance.now(); t0=stepStart;
    if(raf) cancelAnimationFrame(raf); raf=requestAnimationFrame(tick);
  }
  function tick(now){
    if(phase==='forward'){
      var prog=(now-stepStart)/FDUR;
      moveDotF(idx,Math.min(1,prog));
      if(prog>=1){
        if(idx===failAt){
          st[idx]='failed'; paint(idx); dotF.setAttribute('opacity','0');
          // build compensation queue for committed steps (reverse)
          compQueue=[]; for(var j=idx-1;j>=0;j--){ if(st[j]==='done') compQueue.push(j); }
          if(compQueue.length){ phase='compensate'; startComp(now); }
          else { phase='done'; outcome='rolled back'; finish(); }
        } else {
          st[idx]='done'; paint(idx);
          if(idx<N-1){ fEdges[idx].setAttribute('stroke','color-mix(in oklch,var(--grn) 45%,transparent)'); idx++; st[idx]='running'; paint(idx); stepStart=now; }
          else { phase='done'; outcome='committed'; dotF.setAttribute('opacity','0'); finish(); }
        }
        setStats();
      }
      raf=requestAnimationFrame(tick);
    } else if(phase==='compensate'){
      var ci=compQueue[0];
      var cp=(now-stepStart)/CDUR;
      if(cp>=1){
        st[ci]='undone'; paint(ci); compQueue.shift();
        // light reverse edge from this step back to previous comp
        if(ci<N-1) rEdges[ci].setAttribute('opacity','0');
        if(ci>0) rEdges[ci-1].setAttribute('opacity','0.9');
        setStats();
        if(compQueue.length){ stepStart=now; st[compQueue[0]]='comp'; paint(compQueue[0]); }
        else { phase='done'; outcome='rolled back'; finish(); return; }
      }
      raf=requestAnimationFrame(tick);
    }
  }
  function startComp(now){
    var ci=compQueue[0]; st[ci]='comp'; paint(ci); stepStart=now;
    if(ci<N-1) rEdges[ci].setAttribute('opacity','0.9');
  }
  function moveDotF(i,p){
    if(i>=N-1){ dotF.setAttribute('opacity','0'); return; }
    var x1=CX[i]+CW/2, x2=CX[i+1]-CW/2;
    dotF.setAttribute('opacity', st[i]==='running'?'1':'0');
    dotF.setAttribute('cx', x1+(x2-x1)*p); dotF.setAttribute('cy', CYC-6);
  }
  function finish(){ phase='done'; setRunBtn(false); setStats(); if(raf){ cancelAnimationFrame(raf); raf=null; } }

  function instant(){
    if(failAt<0){ st=STEPS.map(function(){return 'done';}); outcome='committed'; fEdges.forEach(function(e){e.setAttribute('stroke','color-mix(in oklch,var(--grn) 45%,transparent)');}); }
    else { for(var i=0;i<failAt;i++) st[i]='undone'; st[failAt]='failed'; for(var j=failAt+1;j<N;j++) st[j]='pending'; outcome='rolled back'; }
    phase='done'; cards.forEach(function(_,i){ paint(i); }); setRunBtn(false); setStats();
  }

  // ---- controls ----
  document.querySelectorAll('#saga-fail button').forEach(function(b){
    b.addEventListener('click',function(){
      failAt=parseInt(b.getAttribute('data-v'),10);
      document.querySelectorAll('#saga-fail button').forEach(function(x){ var on=x===b; x.setAttribute('data-on', on?'1':'0'); x.setAttribute('aria-pressed', on?'true':'false'); });
      reset();
    });
  });
  el('saga-run').addEventListener('click',function(){ if(phase==='forward'||phase==='compensate') return; run(); });
  el('saga-reset').addEventListener('click',function(){ if(raf) cancelAnimationFrame(raf); raf=null; reset(); });

  window.__taskitoDemos=window.__taskitoDemos||{};
  var pm=window.__taskitoDemos.motion;
  window.__taskitoDemos.motion=function(off){ if(pm)pm(off); if(off && raf){ cancelAnimationFrame(raf); raf=null; instant(); } };

  reset();
  if(motionOff()){ instant(); }
  else if(document.body.hasAttribute('data-embed')){ run(); }
  else {
    var io=new IntersectionObserver(function(es){ es.forEach(function(e){ if(e.isIntersecting && phase==='idle'){ run(); io.disconnect(); } }); },{threshold:0.3});
    io.observe(root);
  }
})();
