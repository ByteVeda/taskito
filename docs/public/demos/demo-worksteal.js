/* ============================================================
   taskito · Demo 07 — Multi-region work-stealing mesh
   taskito runs in several regions that gossip queue depth. When
   one region's backlog spikes, an idle peer steals a batch over
   HTTP — load self-balances with no central broker.
   Tier-1: SVG + requestAnimationFrame. No WebGL.
   ============================================================ */
(function(){
  var root=document.getElementById('worksteal-root');
  if(!root) return;
  var W=940,H=540, SVGNS='http://www.w3.org/2000/svg';
  var JOB_MS=820, STEAL_INT=620, HOT=5, COOL=2;

  // equirectangular world map: lon/lat -> SVG x/y (map band centered in the viewBox)
  var MAPH=470, MAPY=35;
  function proj(lon,lat){ return [(lon+180)/360*W, (90-lat)/180*MAPH+MAPY]; }
  function landPath(pts){ return 'M'+pts.map(function(c){ var p=proj(c[0],c[1]); return p[0].toFixed(1)+' '+p[1].toFixed(1); }).join(' L ')+' Z'; }
  // simplified continent outlines (lon,lat) — geographically placed, low-poly
  var CONTINENTS=[
    [[-165,60],[-150,70],[-120,70],[-95,72],[-80,68],[-78,55],[-64,48],[-70,42],[-76,35],[-81,25],[-92,18],[-100,18],[-106,23],[-114,31],[-123,40],[-124,49],[-133,55],[-150,58]], // North America
    [[-80,8],[-72,11],[-60,5],[-50,0],[-44,-2],[-40,-10],[-48,-23],[-58,-34],[-66,-44],[-72,-52],[-75,-48],[-71,-35],[-70,-18],[-76,-12],[-81,-5]], // South America
    [[-16,14],[-12,28],[-2,35],[10,37],[20,33],[32,31],[35,24],[43,12],[51,11],[48,0],[41,-12],[35,-22],[25,-34],[18,-35],[11,-16],[9,0],[-2,5],[-12,8]], // Africa
    [[-9,36],[-2,44],[2,50],[-4,58],[5,62],[14,66],[28,71],[55,70],[75,73],[100,73],[130,71],[155,68],[170,66],[165,60],[150,58],[142,50],[133,43],[123,40],[122,31],[112,21],[103,14],[97,8],[93,20],[88,21],[80,7],[76,8],[70,18],[63,24],[56,26],[48,30],[42,37],[30,36],[22,40],[14,45],[4,43]], // Eurasia
    [[-5,50],[-2,51],[1,53],[-2,56],[-6,58],[-9,55],[-10,52]], // British Isles
    [[133,32],[138,34],[143,39],[145,43],[143,45],[139,43],[136,39],[133,36],[131,33]], // Japan
    [[114,-22],[122,-18],[131,-12],[137,-11],[143,-11],[147,-20],[150,-37],[141,-38],[131,-32],[120,-34],[114,-26]] // Australia
  ];
  var LAND_D=CONTINENTS.map(landPath).join(' ');

  // regions placed at their real lon/lat; cards are spread out and connected to a map pin
  var REG=[
    {id:'us-west-2',     loc:'Oregon',     lon:-120, lat:45, cardX:44,  cardY:58,  q:2, rate:0.30},
    {id:'us-east-1',     loc:'N. Virginia',lon:-77,  lat:38, cardX:120, cardY:214, q:2, rate:0.30},
    {id:'eu-west',       loc:'Ireland',    lon:-7,   lat:53, cardX:386, cardY:44,  q:2, rate:1.35},
    {id:'ap-south-1',    loc:'Mumbai',     lon:73,   lat:19, cardX:560, cardY:300, q:1, rate:0.34},
    {id:'ap-northeast-1',loc:'Tokyo',      lon:139,  lat:36, cardX:742, cardY:66,  q:2, rate:0.34}
  ];
  REG.forEach(function(r){ var p=proj(r.lon,r.lat); r.gx=Math.round(p[0]); r.gy=Math.round(p[1]); r.dx=r.gx; r.dy=r.gy; r.busy=[0,0]; });
  var byId={}; REG.forEach(function(r){ byId[r.id]=r; });
  var LINKS=[
    ['us-west-2','eu-west',85],['eu-west','ap-northeast-1',88],['eu-west','ap-south-1',139],
    ['us-west-2','us-east-1',null],['us-east-1','eu-west',null],['ap-south-1','ap-northeast-1',null],
    ['us-east-1','ap-south-1',null]
  ];
  var HOPS=[];

  root.innerHTML=
  '<div class="demo-bar">'+
    '<span class="title"><span class="ld"></span>region-mesh · gossip</span>'+
    '<div class="demo-controls">'+
      '<button class="ctl pri" id="ws-burst"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>Burst</button>'+
      '<button class="ctl" id="ws-reset"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>Reset</button>'+
      '<button class="ctl" id="ws-pause"><svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>Pause</button>'+
    '</div>'+
  '</div>'+
  '<div class="stage"><svg id="ws-svg" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="A world map with five taskito regions connected by a gossip mesh. When one region\'s queue spikes, idle regions steal batches of jobs over HTTP so load balances out.">'+
    '<defs><pattern id="ws-grid" width="36" height="36" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="var(--line)"/></pattern></defs>'+
    '<rect width="'+W+'" height="'+H+'" fill="url(#ws-grid)" opacity=".7"/>'+
    '<g id="ws-land" opacity=".6"><path d="'+LAND_D+'" fill="var(--line)" stroke="var(--line2)" stroke-width="1" stroke-linejoin="round"/></g>'+
    '<g id="ws-links"></g><g id="ws-leads"></g><g id="ws-pins"></g><g id="ws-hops"></g><g id="ws-tokens"></g><g id="ws-cards"></g>'+
  '</svg></div>'+
  '<div class="legend">'+
    '<span><i style="background:var(--grn)"></i>region node</span>'+
    '<span><i style="width:16px;height:0;border-top:2px dashed color-mix(in oklch,var(--grn) 50%,transparent);border-radius:0;background:none"></i>mesh link (gossip)</span>'+
    '<span><i style="width:16px;height:0;border-top:2px solid var(--cyan);border-radius:0;background:none"></i>work-steal over HTTP</span>'+
  '</div>'+
  '<div class="readout">'+
    stat('completed','ws-completed','good')+stat('steals','ws-steals')+stat('moved · HTTP','ws-moved','warn')+
    stat('busiest queue','ws-hot')+
  '</div>';

  function stat(k,id,cls){ return '<div class="stat"><span class="k">'+k+'</span><span class="v'+(cls?' '+cls:'')+'" id="'+id+'">0</span></div>'; }
  function el(id){ return document.getElementById(id); }
  var gLinks=el('ws-links'), gHops=el('ws-hops'), gTok=el('ws-tokens'), gCards=el('ws-cards');

  // ---- links + latency pills ----
  var linkEls=[];
  LINKS.forEach(function(L){
    var a=byId[L[0]], b=byId[L[1]];
    var p=document.createElementNS(SVGNS,'line');
    p.setAttribute('x1',a.dx); p.setAttribute('y1',a.dy); p.setAttribute('x2',b.dx); p.setAttribute('y2',b.dy);
    p.setAttribute('stroke','color-mix(in oklch,var(--grn) 38%,transparent)'); p.setAttribute('stroke-width','1.6');
    p.setAttribute('stroke-dasharray','2 6'); p.setAttribute('stroke-linecap','round');
    gLinks.appendChild(p); linkEls.push({a:a,b:b,line:p,solid:0});
    if(L[2]!=null){
      var mx=(a.dx+b.dx)/2, my=(a.dy+b.dy)/2;
      var g=document.createElementNS(SVGNS,'g');
      g.innerHTML='<rect x="'+(mx-21)+'" y="'+(my-11)+'" width="42" height="22" rx="7" fill="var(--panel)" stroke="color-mix(in oklch,var(--grn) 32%,transparent)"/>'+
        '<text x="'+mx+'" y="'+(my+4)+'" text-anchor="middle" font-family="var(--mono)" font-size="10.5" fill="var(--mut)">'+L[2]+' ms</text>';
      gLinks.appendChild(g);
    }
  });
  HOPS.forEach(function(h){
    var c=document.createElementNS(SVGNS,'circle');
    c.setAttribute('cx',h[0]); c.setAttribute('cy',h[1]); c.setAttribute('r','5');
    c.setAttribute('fill','color-mix(in oklch,var(--cyan) 60%,var(--panel))'); c.setAttribute('opacity','.85');
    gHops.appendChild(c);
  });

  // ---- region cards ----
  REG.forEach(function(r){
    var x=r.cardX, y=r.cardY, w=156, h=80;
    var g=document.createElementNS(SVGNS,'g');
    g.innerHTML=
      '<rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" rx="13" fill="var(--panel)" stroke="var(--line2)" data-rect/>'+
      '<circle cx="'+(x+16)+'" cy="'+(y+18)+'" r="5.5" fill="var(--grn)" data-dot/>'+
      '<text x="'+(x+30)+'" y="'+(y+22)+'" font-family="var(--code)" font-size="12.5" font-weight="700" fill="var(--txt)">'+r.id+'</text>'+
      '<text x="'+(x+30+labelW(r.id))+'" y="'+(y+22)+'" font-family="var(--mono)" font-size="10" fill="var(--dim)"> '+r.loc+'</text>'+
      '<g data-workers transform="translate('+(x+16)+','+(y+36)+')"></g>'+
      '<text x="'+(x+16)+'" y="'+(y+70)+'" font-family="var(--mono)" font-size="11" fill="var(--mut)"><tspan data-q font-weight="600" fill="var(--txt2)">'+r.q+'</tspan> queued</text>';
    gCards.appendChild(g);
    r.g=g; r.rect=g.querySelector('[data-rect]'); r.qEl=g.querySelector('[data-q]'); r.wkEl=g.querySelector('[data-workers]'); r.dot=g.querySelector('[data-dot]');
    for(var i=0;i<2;i++){
      var sq=document.createElementNS(SVGNS,'rect');
      sq.setAttribute('x',i*18); sq.setAttribute('y',0); sq.setAttribute('width',13); sq.setAttribute('height',13); sq.setAttribute('rx',3.5);
      sq.setAttribute('fill','var(--panel3)'); sq.setAttribute('stroke','var(--line2)'); r.wkEl.appendChild(sq);
    }
  });
  function labelW(s){ return s.length*7.1+4; }

  // ---- geographic pins + leader lines from each card to its real location ----
  var gLeads=el('ws-leads'), gPins=el('ws-pins');
  REG.forEach(function(r){
    var ln=document.createElementNS(SVGNS,'line');
    ln.setAttribute('x1',r.cardX+78); ln.setAttribute('y1',r.cardY+40);
    ln.setAttribute('x2',r.gx); ln.setAttribute('y2',r.gy);
    ln.setAttribute('stroke','var(--line2)'); ln.setAttribute('stroke-width','1.3');
    ln.setAttribute('stroke-dasharray','1 4'); ln.setAttribute('stroke-linecap','round');
    gLeads.appendChild(ln);
    var pin=document.createElementNS(SVGNS,'g');
    pin.innerHTML='<circle cx="'+r.gx+'" cy="'+r.gy+'" r="11" fill="color-mix(in oklch,var(--grn) 13%,transparent)"/>'+
      '<circle cx="'+r.gx+'" cy="'+r.gy+'" r="4.5" fill="var(--grn)" stroke="var(--panel)" stroke-width="1.5"/>';
    gPins.appendChild(pin);
  });

  // ---- metrics ----
  var completed=0, steals=0, moved=0, tokens=[];

  function poisson(m){ if(m<=0)return 0; var L=Math.exp(-m),k=0,p=1; do{k++;p*=Math.random();}while(p>L); return k-1; }

  function stepSim(now,dt){
    REG.forEach(function(r){
      r.q += poisson(r.rate*dt);
      for(var i=0;i<2;i++){
        if(r.busy[i] && now>=r.busy[i]){ r.busy[i]=0; completed++; }
        if(!r.busy[i] && r.q>0){ r.q--; r.busy[i]=now+JOB_MS*(0.8+Math.random()*0.5); }
      }
    });
  }

  var stealAcc=0;
  function trySteal(now,dt){
    stealAcc+=dt*1000; if(stealAcc<STEAL_INT) return; stealAcc=0;
    // busiest region
    var hot=REG.slice().sort(function(a,b){return b.q-a.q;})[0];
    if(hot.q<HOT) return;
    // an idle linked peer with a free worker
    var peers=linkEls.filter(function(L){ return L.a===hot||L.b===hot; })
      .map(function(L){ return L.a===hot?L.b:L.a; })
      .filter(function(p){ return p.q<=COOL && p.busy.indexOf(0)>=0; })
      .sort(function(a,b){ return a.q-b.q; });
    if(!peers.length) return;
    var dst=peers[0];
    var batch=Math.max(1,Math.min(4,Math.floor((hot.q-dst.q)/2)));
    hot.q-=batch;
    steals++;
    spawnSteal(hot,dst,batch,now);
  }

  function spawnSteal(a,b,batch,now){
    var link=linkEls.filter(function(L){ return (L.a===a&&L.b===b)||(L.a===b&&L.b===a); })[0];
    if(link) link.solid=now+700;
    var g=document.createElementNS(SVGNS,'g'); g.setAttribute('class','ws-steal');
    g.innerHTML='<circle r="8" fill="var(--cyan)" opacity=".95"/><text text-anchor="middle" y="3.5" font-family="var(--code)" font-size="9" font-weight="700" fill="#06281f">'+batch+'</text>';
    gTok.appendChild(g);
    var dist=Math.hypot(b.dx-a.dx,b.dy-a.dy);
    tokens.push({ax:a.dx,ay:a.dy,bx:b.dx,by:b.dy,dst:b,batch:batch,t0:now,dur:Math.max(620,dist*1.6),g:g,done:false});
  }

  function moveTokens(now){
    for(var i=tokens.length-1;i>=0;i--){
      var t=tokens[i], p=Math.min(1,(now-t.t0)/t.dur);
      var x=t.ax+(t.bx-t.ax)*p, y=t.ay+(t.by-t.ay)*p;
      t.g.setAttribute('transform','translate('+x.toFixed(1)+','+y.toFixed(1)+')');
      t.g.firstChild.setAttribute('opacity', (p<0.1?p/0.1:(p>0.9?(1-(p-0.9)/0.1)*0.95:0.95)).toFixed(2));
      if(p>=1 && !t.done){ t.done=true; t.dst.q+=t.batch; moved+=t.batch; if(t.g.parentNode) t.g.parentNode.removeChild(t.g); tokens.splice(i,1); }
    }
  }

  function paint(now){
    var hotQ=0, hotName='—';
    REG.forEach(function(r){
      r.qEl.textContent=r.q;
      if(r.q>hotQ){ hotQ=r.q; hotName=r.id; }
      var hot=r.q>=HOT;
      r.rect.setAttribute('stroke', hot?'color-mix(in oklch,var(--amber) 55%,transparent)':'var(--line2)');
      r.rect.setAttribute('fill', hot?'color-mix(in oklch,var(--amber) 7%,var(--panel))':'var(--panel)');
      // worker squares
      [].forEach.call(r.wkEl.children,function(sq,i){
        var busy = !!r.busy[i];
        sq.setAttribute('fill', busy?'var(--grn)':'var(--panel3)');
        sq.setAttribute('stroke', busy?'color-mix(in oklch,var(--grn) 55%,transparent)':'var(--line2)');
      });
    });
    // link styling: solid teal briefly after a steal
    linkEls.forEach(function(L){
      var on = L.solid>now;
      L.line.setAttribute('stroke', on?'var(--cyan)':'color-mix(in oklch,var(--grn) 38%,transparent)');
      L.line.setAttribute('stroke-dasharray', on?'':'2 6');
      L.line.setAttribute('stroke-width', on?'2.2':'1.6');
    });
    el('ws-completed').textContent=completed;
    el('ws-steals').textContent=steals;
    el('ws-moved').textContent=moved;
    el('ws-hot').textContent=hotQ;
  }

  // ---- loop ----
  function motionOff(){ return window.__motionOff || (window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches); }
  var raf=null,last=0,paused=false;
  function loop(now){
    if(!last) last=now; var dt=Math.min((now-last)/1000,0.05); last=now;
    stepSim(now,dt); trySteal(now,dt); moveTokens(now); paint(now);
    raf=requestAnimationFrame(loop);
  }
  function start(){ if(raf||paused) return; last=0; raf=requestAnimationFrame(loop); }
  function stop(){ if(raf){ cancelAnimationFrame(raf); raf=null; } }

  function staticRender(){ var now=performance.now(); REG.forEach(function(r){ r.busy=[now+1,0]; }); paint(now); }

  el('ws-burst').addEventListener('click',function(){
    // dump load onto the already-busiest region to force a steal
    var hot=REG.slice().sort(function(a,b){return b.q-a.q;})[0]; hot.q+=7;
    if(motionOff()) staticRender(); else paint(performance.now());
  });
  el('ws-reset').addEventListener('click',function(){
    completed=0;steals=0;moved=0; tokens.forEach(function(t){ if(t.g.parentNode) t.g.parentNode.removeChild(t.g); }); tokens=[];
    REG.forEach(function(r){ r.q=r.id==='ap-south-1'?1:2; r.busy=[0,0]; });
    paint(performance.now());
  });
  el('ws-pause').addEventListener('click',function(){
    paused=!paused;
    el('ws-pause').innerHTML = paused
      ? '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M8 5v14l11-7z"/></svg>Resume'
      : '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>Pause';
    if(paused) stop(); else start();
  });

  window.__taskitoDemos=window.__taskitoDemos||{};
  var pm=window.__taskitoDemos.motion;
  window.__taskitoDemos.motion=function(off){ if(pm)pm(off); if(off){ stop(); staticRender(); } else { paused=false; start(); } };

  paint(performance.now());
  if(motionOff()){ staticRender(); }
  else { start(); }
})();
