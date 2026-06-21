/* ============================================================
   taskito · Demo 05 — Mesh scheduling
   Jobs carry a routing key; the brokerless mesh sends each to a
   worker pool built to run it (gpu / default / email). Click a
   machine to drop it and watch its work reroute across the mesh.
   Tier-1: SVG + requestAnimationFrame. No WebGL.
   ============================================================ */
(function(){
  var root=document.getElementById('mesh-root');
  if(!root) return;

  var W=940,H=330;
  var DISP={x:92,y:165};
  var EX=430;                 // pool entry x
  var SPEED=560;
  var POOLS=[
    {key:'gpu',     label:'gpu · render',  col:'var(--cyan)',      y:60,  n:2, dur:1650},
    {key:'default', label:'default · web', col:'var(--indigo-br)', y:165, n:3, dur:900},
    {key:'email',   label:'email · notify',col:'var(--amber)',     y:270, n:2, dur:720}
  ];
  var NX0=560, NSTEP=128, NW=104, NH=46;
  var WEIGHT={gpu:0.24, default:0.52, email:0.24};

  // build node models
  POOLS.forEach(function(p){
    p.nodes=[]; p.wait=[];
    for(var i=0;i<p.n;i++) p.nodes.push({x:NX0+i*NSTEP, y:p.y, busy:null, off:false, pip:null, rect:null, xg:null, g:null});
  });
  var metrics={routed:0, rerouted:0};

  // ---- DOM ----
  root.innerHTML=
  '<div class="demo-bar">'+
    '<span class="title"><span class="ld"></span>worker-mesh · live</span>'+
    '<div class="demo-controls">'+
      '<span class="mesh-hint"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v.01M12 13.5a2 2 0 0 0 .914-3.782 1.98 1.98 0 0 0-2.414.483"/><circle cx="12" cy="12" r="9"/></svg>click a machine to drop it</span>'+
      '<button class="ctl pri" id="mesh-burst"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z"/></svg>Send burst (6)</button>'+
    '</div>'+
  '</div>'+
  '<div class="stage"><svg id="mesh-svg" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Mesh scheduling: jobs leave a dispatcher and route by key to one of three worker pools — gpu, default, and email. Click a worker to take it offline and its jobs reroute to the rest of its pool.">'+
    '<defs><marker id="mesh-ar" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M1 1 L9 5 L1 9" fill="none" stroke="var(--line3)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></marker></defs>'+
    '<g id="mesh-wires"></g>'+
    // dispatcher
    '<g><rect x="36" y="133" width="112" height="64" rx="13" fill="var(--panel3)" stroke="var(--line2)"/>'+
      '<text x="92" y="159" text-anchor="middle" font-family="var(--mono)" font-size="11" fill="var(--mut)">dispatcher</text>'+
      '<text x="92" y="178" text-anchor="middle" font-family="var(--code)" font-size="11" font-weight="600" fill="var(--txt2)">route()</text></g>'+
    '<g id="mesh-pools"></g>'+
    '<g id="mesh-tokens"></g>'+
  '</svg></div>'+
  '<div class="legend">'+
    '<span><i style="background:var(--cyan)"></i>gpu job</span>'+
    '<span><i style="background:var(--indigo-br)"></i>default job</span>'+
    '<span><i style="background:var(--amber)"></i>email job</span>'+
    '<span><i style="background:var(--grn)"></i>worker busy</span>'+
    '<span><i style="background:var(--dim)"></i>offline</span>'+
  '</div>'+
  '<div class="readout">'+
    stat('nodes online','mesh-online')+stat('routing','mesh-flight')+stat('waiting','mesh-wait','warn')+
    stat('routed','mesh-routed','good')+stat('rerouted','mesh-reroute')+
  '</div>';

  function stat(k,id,cls){ return '<div class="stat"><span class="k">'+k+'</span><span class="v'+(cls?' '+cls:'')+'" id="'+id+'">0</span></div>'; }
  function el(id){ return document.getElementById(id); }
  var SVGNS='http://www.w3.org/2000/svg';

  // ---- wires + pools render ----
  var gWires=el('mesh-wires'), gPools=el('mesh-pools'), gTok=el('mesh-tokens');
  POOLS.forEach(function(p){
    // dispatcher → entry
    var mx=(148+EX)/2;
    addPath('M148 165 C '+mx+' 165, '+mx+' '+p.y+', '+EX+' '+p.y, 'var(--line2)', true);
    // pool lane chip
    var chip=document.createElementNS(SVGNS,'g');
    chip.innerHTML='<rect x="300" y="'+(p.y-15)+'" width="120" height="30" rx="9" fill="var(--panel)" stroke="'+p.col+'" opacity="1"/>'+
      '<rect x="300" y="'+(p.y-15)+'" width="120" height="30" rx="9" fill="none" stroke="color-mix(in oklch,'+p.col+' 40%,transparent)"/>'+
      '<circle cx="316" cy="'+p.y+'" r="4" fill="'+p.col+'"/>'+
      '<text x="328" y="'+(p.y+4)+'" font-family="var(--mono)" font-size="11" fill="var(--txt2)">'+p.label+'</text>';
    gPools.appendChild(chip);
    p.nodes.forEach(function(node){
      addPath('M420 '+p.y+' H '+(node.x-NW/2), 'var(--line2)', false);
      var g=document.createElementNS(SVGNS,'g'); g.setAttribute('class','mesh-node'); g.style.cursor='pointer';
      g.setAttribute('tabindex','0'); g.setAttribute('role','button'); g.setAttribute('aria-label',p.key+' worker — click to toggle offline');
      var rect=document.createElementNS(SVGNS,'rect');
      rect.setAttribute('x',node.x-NW/2); rect.setAttribute('y',node.y-NH/2); rect.setAttribute('width',NW); rect.setAttribute('height',NH);
      rect.setAttribute('rx','11'); rect.setAttribute('fill','var(--panel2)'); rect.setAttribute('stroke','var(--line2)');
      var pip=document.createElementNS(SVGNS,'circle');
      pip.setAttribute('cx',node.x+NW/2-13); pip.setAttribute('cy',node.y-NH/2+13); pip.setAttribute('r','4'); pip.setAttribute('fill','var(--dim)');
      var t=document.createElementNS(SVGNS,'text');
      t.setAttribute('x',node.x-NW/2+12); t.setAttribute('y',node.y+4); t.setAttribute('font-family','var(--code)'); t.setAttribute('font-size','11');
      t.setAttribute('font-weight','600'); t.setAttribute('fill','var(--txt2)'); t.textContent=p.key+'-'+(p.nodes.indexOf(node)+1);
      var xg=document.createElementNS(SVGNS,'path');
      xg.setAttribute('d','M'+(node.x-9)+' '+(node.y-9)+' l18 18 M'+(node.x+9)+' '+(node.y-9)+' l-18 18');
      xg.setAttribute('stroke','var(--red)'); xg.setAttribute('stroke-width','2'); xg.setAttribute('stroke-linecap','round'); xg.setAttribute('opacity','0');
      g.appendChild(rect); g.appendChild(pip); g.appendChild(t); g.appendChild(xg);
      gPools.appendChild(g);
      node.rect=rect; node.pip=pip; node.xg=xg; node.g=g; node.pool=p;
      g.addEventListener('click',function(){ toggleNode(node); });
      g.addEventListener('keydown',function(e){ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); toggleNode(node); } });
    });
  });
  function addPath(d,stroke,arrow){
    var pth=document.createElementNS(SVGNS,'path');
    pth.setAttribute('d',d); pth.setAttribute('fill','none'); pth.setAttribute('stroke',stroke);
    pth.setAttribute('stroke-width','2'); pth.setAttribute('stroke-dasharray','2 7'); pth.setAttribute('stroke-linecap','round');
    if(arrow) pth.setAttribute('marker-end','url(#mesh-ar)');
    gWires.appendChild(pth);
  }

  // ---- tokens ----
  var tokens=[];
  function poolByKey(k){ return POOLS.filter(function(p){return p.key===k;})[0]; }
  function pickKey(){ var r=Math.random(); if(r<WEIGHT.gpu) return 'gpu'; if(r<WEIGHT.gpu+WEIGHT.default) return 'default'; return 'email'; }

  function emit(n){
    for(var i=0;i<n;i++){
      if(tokens.length>34) break;
      var key=pickKey(), p=poolByKey(key);
      var t={key:key,pool:p,x:DISP.x+22,y:DISP.y+(Math.random()*16-8),r:6,node:null,phase:'toentry',tx:EX,ty:p.y,pUntil:0};
      var c=document.createElementNS(SVGNS,'circle'); c.setAttribute('r','6'); c.style.fill=p.col; t.el=c; gTok.appendChild(c);
      tokens.push(t);
    }
  }

  function freeNode(p){ for(var i=0;i<p.nodes.length;i++){ var nd=p.nodes[i]; if(!nd.off && !nd.busy) return nd; } return null; }
  function assignPool(p){
    var nd;
    while(p.wait.length && (nd=freeNode(p))){
      var t=p.wait.shift(); nd.busy=t; t.node=nd; t.phase='tonode'; t.tx=nd.x; t.ty=nd.y;
    }
  }
  function arriveEntry(t){
    var nd=freeNode(t.pool);
    if(nd){ nd.busy=t; t.node=nd; t.phase='tonode'; t.tx=nd.x; t.ty=nd.y; }
    else { t.phase='waiting'; var idx=t.pool.wait.length; t.pool.wait.push(t); t.tx=445; t.ty=t.pool.y-20+idx*13; }
  }

  function toggleNode(node){
    node.off=!node.off;
    if(node.off && node.busy){
      var t=node.busy; node.busy=null;
      // requeue to front, reroute
      metrics.rerouted++;
      t.node=null; t.phase='waiting'; node.pool.wait.unshift(t); t.tx=445; t.ty=node.pool.y-20;
    }
    paintNode(node);
    if(!node.off) assignPool(node.pool);
    if(motionOff()) staticRender();
  }

  function paintNode(nd){
    if(nd.off){
      nd.rect.setAttribute('fill','var(--panel)'); nd.rect.setAttribute('stroke','var(--line2)');
      nd.rect.setAttribute('stroke-dasharray','3 5'); nd.pip.setAttribute('fill','var(--dim)'); nd.xg.setAttribute('opacity','.8');
      nd.g.style.opacity='.55';
    } else {
      nd.rect.setAttribute('stroke-dasharray',''); nd.xg.setAttribute('opacity','0'); nd.g.style.opacity='1';
      if(nd.busy){
        nd.rect.setAttribute('fill','color-mix(in oklch,'+nd.pool.col+' 16%,transparent)');
        nd.rect.setAttribute('stroke','color-mix(in oklch,'+nd.pool.col+' 50%,transparent)');
        nd.pip.setAttribute('fill','var(--grn)');
      } else {
        nd.rect.setAttribute('fill','var(--panel2)'); nd.rect.setAttribute('stroke','var(--line2)');
        nd.pip.setAttribute('fill','var(--dim)');
      }
    }
  }

  function step(now,dt){
    if(!motionOff()){ emitAcc+=dt; if(emitAcc>880){ emitAcc=0; if(tokens.length<26) emit(1); } }
    var move=SPEED*dt/1000;
    // re-stack waiting tokens
    POOLS.forEach(function(p){ p.wait.forEach(function(t,i){ t.tx=445; t.ty=p.y-20+i*13; }); assignPool(p); });
    for(var i=tokens.length-1;i>=0;i--){
      var t=tokens[i], dx=t.tx-t.x, dy=t.ty-t.y, d=Math.hypot(dx,dy);
      if(d>0.5){ var s=Math.min(move,d); t.x+=dx/d*s; t.y+=dy/d*s; }
      var arrived=d<2.5;
      switch(t.phase){
        case 'toentry': if(arrived) arriveEntry(t); break;
        case 'tonode': if(arrived){ t.phase='processing'; t.pUntil=now+t.pool.dur*(0.82+Math.random()*0.4); } break;
        case 'processing':
          if(now>=t.pUntil){ var nd=t.node; if(nd){ nd.busy=null; paintNode(nd); assignPool(t.pool); } metrics.routed++; t.phase='done'; t.tx=W+30; t.ty=t.y; }
          break;
        case 'done': if(t.x>W+20){ rm(t,i); } break;
      }
      if(t.el){ t.el.setAttribute('cx',t.x.toFixed(1)); t.el.setAttribute('cy',t.y.toFixed(1));
        t.el.setAttribute('r', t.phase==='processing'?'6.5':'6');
        t.el.style.opacity = t.phase==='waiting'?'0.8':'1'; }
    }
    POOLS.forEach(function(p){ p.nodes.forEach(paintNode); });
    paintStats();
  }
  function rm(t,i){ if(t.el&&t.el.parentNode) t.el.parentNode.removeChild(t.el); tokens.splice(i,1); }

  function paintStats(){
    var online=0,total=0,busy=0,waiting=0;
    POOLS.forEach(function(p){ p.nodes.forEach(function(nd){ total++; if(!nd.off) online++; if(nd.busy) busy++; }); waiting+=p.wait.length; });
    var flight=tokens.filter(function(t){return t.phase==='toentry'||t.phase==='tonode';}).length;
    setTxt('mesh-online',online+' / '+total);
    setTxt('mesh-flight',flight+busy);
    var w=el('mesh-wait'); w.textContent=waiting; w.className='v '+(waiting>0?'warn':'');
    setTxt('mesh-routed',metrics.routed);
    var r=el('mesh-reroute'); r.textContent=metrics.rerouted; r.className='v '+(metrics.rerouted>0?'bad':'');
  }
  function setTxt(id,v){ el(id).textContent=v; }

  // ---- controls / motion ----
  function motionOff(){ return window.__motionOff || (window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches); }
  el('mesh-burst').addEventListener('click',function(){ emit(6); if(motionOff()) staticRender(); });

  var emitAcc=0,last=0,raf=null;
  function loop(now){ if(!last) last=now; var dt=Math.min(now-last,60); last=now; step(now,dt); raf=requestAnimationFrame(loop); }
  function start(){ if(raf) return; last=0; raf=requestAnimationFrame(loop); }
  function stop(){ if(raf){ cancelAnimationFrame(raf); raf=null; } }

  function staticRender(){
    POOLS.forEach(function(p){ p.wait.forEach(function(t,i){ t.x=445; t.y=p.y-20+i*13; }); assignPool(p);
      p.nodes.forEach(function(nd){ if(nd.busy){ nd.busy.x=nd.x; nd.busy.y=nd.y; nd.busy.phase='processing'; } paintNode(nd); }); });
    tokens.forEach(function(t){ if(t.el){ t.el.setAttribute('cx',t.x.toFixed(1)); t.el.setAttribute('cy',t.y.toFixed(1)); } });
    paintStats();
  }
  function seedStatic(){
    emit(7);
    tokens.forEach(function(t){ t.x=EX; t.y=t.pool.y; arriveEntry(t); });
    staticRender();
  }

  window.__taskitoDemos=window.__taskitoDemos||{};
  var pm=window.__taskitoDemos.motion, pr=window.__taskitoDemos.recolor;
  window.__taskitoDemos.motion=function(off){ if(pm)pm(off); if(off){ stop(); staticRender(); } else { start(); } };
  window.__taskitoDemos.recolor=function(){ if(pr)pr(); POOLS.forEach(function(p){ p.nodes.forEach(paintNode); }); };

  POOLS.forEach(function(p){ p.nodes.forEach(paintNode); });
  if(motionOff()){ seedStatic(); }
  else { emit(3); start(); }
})();
