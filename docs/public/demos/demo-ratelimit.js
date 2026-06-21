/* ============================================================
   taskito · Demo 01 — API rate limiting
   Request -> Queue -> Workers -> External API, with 429 + backoff.
   Tier-1: SVG + requestAnimationFrame. No WebGL.
   ============================================================ */
(function(){
  var root=document.getElementById('rl-root');
  if(!root) return;

  var W=960,H=300,CY=152;
  var NWORK=5;
  var PROC=1050, BACKOFF_BASE=620, MAX_RETRY=4, SPEED=560;
  var SPAWN_MS=1000, QCAP=12;

  // worker slot anchors
  var slots=[];
  for(var i=0;i<NWORK;i++){ slots.push({x:622, y:86+i*38, busy:null}); }
  var PRO={x:90,y:CY}, QBOX={x:286,w:108,y:CY}, API={x:862,y:CY};

  // ---- build DOM ----
  root.innerHTML =
  '<div class="demo-bar">'+
    '<span class="title"><span class="ld"></span>rate-limit · live</span>'+
    '<div class="demo-controls">'+
      '<button class="ctl pri" id="rl-burst"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z"/></svg>Send burst (8)</button>'+
      '<div class="seg" id="rl-api" role="group" aria-label="External API status">'+
        '<button data-v="ok" class="good" data-on="1"><span class="dot"></span>API: 200 OK</button>'+
        '<button data-v="429" class="bad" data-on="0"><span class="dot"></span>API: 429</button>'+
      '</div>'+
    '</div>'+
  '</div>'+
  '<div class="stage"><svg id="rl-svg" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Animated pipeline: requests move from your code into a queue, are picked up by a pool of workers, and call an external API. When the API returns 429, calls fail and retry with exponential backoff.">'+
    '<defs>'+
      '<marker id="rl-ar" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M1 1 L9 5 L1 9" fill="none" stroke="var(--line3)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></marker>'+
    '</defs>'+
    // guide wires
    '<path d="M150 152 H286" fill="none" stroke="var(--line2)" stroke-width="2" stroke-dasharray="2 7" stroke-linecap="round" marker-end="url(#rl-ar)"/>'+
    '<path d="M394 152 H560" fill="none" stroke="var(--line2)" stroke-width="2" stroke-dasharray="2 7" stroke-linecap="round" marker-end="url(#rl-ar)"/>'+
    '<path d="M690 152 H800" fill="none" stroke="var(--line2)" stroke-width="2" stroke-dasharray="2 7" stroke-linecap="round" marker-end="url(#rl-ar)"/>'+
    // retry return curve
    '<path id="rl-retpath" d="M862 196 C 862 270, 340 286, 300 244" fill="none" stroke="color-mix(in oklch,var(--red) 45%,transparent)" stroke-width="2" stroke-dasharray="2 7" stroke-linecap="round" opacity="0"/>'+
    '<text x="560" y="284" text-anchor="middle" id="rl-retlbl" font-family="var(--mono)" font-size="11" fill="var(--red)" opacity="0">retry · exponential backoff</text>'+
    // producer box
    '<g><rect x="30" y="120" width="120" height="64" rx="13" fill="var(--panel3)" stroke="var(--line2)"/>'+
      '<text x="90" y="146" text-anchor="middle" font-family="var(--mono)" font-size="11" fill="var(--mut)">your code</text>'+
      '<text x="90" y="165" text-anchor="middle" font-family="var(--code)" font-size="12" font-weight="600" fill="var(--txt2)">.delay()</text></g>'+
    // queue box
    '<g><rect x="280" y="86" width="120" height="132" rx="13" fill="var(--panel)" stroke="var(--line2)"/>'+
      '<text x="340" y="106" text-anchor="middle" font-family="var(--mono)" font-size="11" fill="var(--mut)">QUEUE</text>'+
      '<text x="340" y="240" text-anchor="middle" font-family="var(--code)" font-size="11" fill="var(--dim)" id="rl-qovf"></text></g>'+
    // worker pool frame
    '<g><rect x="560" y="64" width="124" height="176" rx="13" fill="none" stroke="var(--line2)" stroke-dasharray="3 6"/>'+
      '<text x="622" y="58" text-anchor="middle" font-family="var(--mono)" font-size="11" fill="var(--mut)">WORKERS · '+NWORK+'</text></g>'+
    workerSlotsSVG()+
    // api box
    '<g id="rl-apibox"><rect x="800" y="110" width="128" height="84" rx="13" fill="var(--panel3)" stroke="var(--line2)" id="rl-apirect"/>'+
      '<text x="864" y="138" text-anchor="middle" font-family="var(--mono)" font-size="11" fill="var(--mut)">external API</text>'+
      '<g id="rl-apistat" transform="translate(864,162)"><rect x="-34" y="-13" width="68" height="26" rx="13" fill="color-mix(in oklch,var(--grn) 16%,transparent)" stroke="color-mix(in oklch,var(--grn) 40%,transparent)" id="rl-apipill"/>'+
        '<text x="0" y="5" text-anchor="middle" font-family="var(--code)" font-size="12" font-weight="700" fill="var(--grn)" id="rl-apitext">200</text></g></g>'+
    '<g id="rl-tokens"></g>'+
  '</svg></div>'+
  '<div class="legend">'+
    '<span><i style="background:var(--indigo-br)"></i>queued</span>'+
    '<span><i style="background:var(--cyan)"></i>processing</span>'+
    '<span><i style="background:var(--grn)"></i>succeeded</span>'+
    '<span><i style="background:var(--red)"></i>429 · retrying</span>'+
    '<span><i style="background:var(--amber)"></i>backoff wait</span>'+
  '</div>'+
  '<div class="readout">'+
    stat('queue depth','rl-qd')+stat('in flight','rl-if')+stat('retries','rl-rt')+
    stat('429 blocked','rl-bk','bad')+stat('succeeded','rl-sc','good')+stat('backoff','rl-bo','warn','s')+
  '</div>';

  function workerSlotsSVG(){
    var s='';
    slots.forEach(function(w,i){
      s+='<rect x="'+(w.x-22)+'" y="'+(w.y-15)+'" width="44" height="30" rx="8" fill="var(--panel2)" stroke="var(--line2)" id="rl-ws'+i+'"/>';
    });
    return s;
  }
  function stat(k,id,cls,u){
    return '<div class="stat"><span class="k">'+k+'</span><span class="v'+(cls?' '+cls:'')+'" id="'+id+'">0'+(u?'<span class="u">'+u+'</span>':'')+'</span></div>';
  }

  // ---- state ----
  var tokens=[], idc=0, apiOK=true;
  var metrics={retries:0, blocked:0, succeeded:0};
  var gTok=document.getElementById('rl-tokens');
  var elQd=g('rl-qd'),elIf=g('rl-if'),elRt=g('rl-rt'),elBk=g('rl-bk'),elSc=g('rl-sc'),elBo=g('rl-bo'),elOvf=g('rl-qovf');
  function g(id){return document.getElementById(id);}

  var COL={queued:'var(--indigo-br)',proc:'var(--cyan)',toapi:'var(--cyan)',success:'var(--grn)',block:'var(--red)',backoff:'var(--amber)'};
  function colorFor(t){
    if(t.phase==='success') return COL.success;
    if(t.phase==='backoff') return COL.backoff;
    if(t.blocked) return COL.block;
    if(t.phase==='processing'||t.phase==='toworker'||t.phase==='toapi') return COL.proc;
    return COL.queued;
  }

  function spawn(n){
    for(var i=0;i<n;i++){
      if(tokens.length>40) break;
      var t={id:++idc,x:PRO.x,y:PRO.y+(Math.random()*20-10),phase:'toqueue',retries:0,blocked:false,
        tx:QBOX.x+12,ty:CY,r:6,worker:null,pUntil:0,bUntil:0,born:performance.now()};
      var el=document.createElementNS('http://www.w3.org/2000/svg','circle');
      el.setAttribute('r','6'); t.el=el; gTok.appendChild(el);
      tokens.push(t);
    }
  }

  function queuedList(){ return tokens.filter(function(t){return t.phase==='queued';}); }

  function assignWorkers(){
    var q=queuedList();
    slots.forEach(function(w){
      if(w.busy==null && q.length){
        var t=q.shift();
        w.busy=t.id; t.worker=slots.indexOf(w);
        t.phase='toworker'; t.tx=w.x; t.ty=w.y;
      }
    });
  }

  function resolveAPI(t){
    var w=slots[t.worker];
    if(apiOK){
      t.phase='success'; t.blocked=false; t.tx=W; t.ty=CY;
      metrics.succeeded++;
      if(w) w.busy=null; t.worker=null;
    } else {
      metrics.blocked++; t.retries++; t.blocked=true;
      if(w) w.busy=null; t.worker=null;
      if(t.retries>MAX_RETRY){
        t.phase='dead'; t.tx=t.x; t.ty=t.y+0; t.dead=performance.now();
      } else {
        metrics.retries++;
        t.phase='backoff'; t.bUntil=performance.now()+BACKOFF_BASE*Math.pow(2,t.retries-1);
        t.tx=QBOX.x+QBOX.w/2; t.ty=CY+58; // park below queue on the return lane
      }
    }
  }

  function step(now,dt){
    // spawn cadence
    if(!motionOff()){
      spawnAcc+=dt;
      if(spawnAcc>SPAWN_MS){ spawnAcc=0; if(queuedList().length<22) spawn(1); }
    }
    assignWorkers();

    // position queued tokens into a packed grid
    var ql=queuedList();
    ql.forEach(function(t,i){
      var col=i%3, rowi=Math.floor(i/3);
      t.tx=300+col*34; t.ty=120+rowi*30;
    });

    var move=SPEED*dt/1000;
    for(var i=tokens.length-1;i>=0;i--){
      var t=tokens[i];
      // arrival-driven transitions
      var dx=t.tx-t.x, dy=t.ty-t.y, d=Math.hypot(dx,dy);
      if(d>0.5){
        var s=Math.min(move,d);
        t.x+=dx/d*s; t.y+=dy/d*s;
      }
      var arrived=d<3;
      switch(t.phase){
        case 'toqueue': if(arrived){ t.phase='queued'; t.blocked=false; } break;
        case 'toworker': if(arrived){ t.phase='processing'; t.pUntil=now+PROC*(0.8+Math.random()*0.5); } break;
        case 'processing': if(now>=t.pUntil){ t.phase='toapi'; t.tx=API.x-26; t.ty=CY; } break;
        case 'toapi': if(arrived){ resolveAPI(t); } break;
        case 'backoff': if(now>=t.bUntil){ t.phase='toqueue'; t.tx=QBOX.x+12; t.ty=CY; } break;
        case 'success': if(t.x>=W-1){ remove(t,i); } break;
        case 'dead': if(now-t.dead>900){ remove(t,i); } break;
      }
      // render
      if(t.el){
        t.el.setAttribute('cx',t.x.toFixed(1));
        t.el.setAttribute('cy',t.y.toFixed(1));
        t.el.style.fill=colorFor(t);
        var op = '1';
        if(t.phase==='dead') op='0.25';
        else if(t.phase==='backoff') op='0.85';
        else if(t.phase==='success') op=Math.max(0,1-(t.x-API.x)/(W-API.x)).toFixed(2); // fade out as it exits
        t.el.style.opacity=op;
        t.el.setAttribute('r', t.phase==='processing'?'6.5':'6');
      }
    }
    paintWorkers();
    paintMetrics(ql.length);
  }
  function remove(t,i){ if(t.el&&t.el.parentNode) t.el.parentNode.removeChild(t.el); tokens.splice(i,1); }

  function paintWorkers(){
    slots.forEach(function(w,i){
      var r=document.getElementById('rl-ws'+i);
      if(!r) return;
      var busy=w.busy!=null;
      r.setAttribute('fill', busy? (apiOK?'color-mix(in oklch,var(--cyan) 18%,transparent)':'color-mix(in oklch,var(--red) 16%,transparent)') : 'var(--panel2)');
      r.setAttribute('stroke', busy? (apiOK?'color-mix(in oklch,var(--cyan) 45%,transparent)':'color-mix(in oklch,var(--red) 45%,transparent)') : 'var(--line2)');
    });
  }

  function paintMetrics(qd){
    var inflight=tokens.filter(function(t){return t.phase==='toworker'||t.phase==='processing'||t.phase==='toapi';}).length;
    var backoff=tokens.filter(function(t){return t.phase==='backoff';}).length;
    var maxBo=0; tokens.forEach(function(t){ if(t.phase==='backoff'){ var s=(t.bUntil-performance.now())/1000; if(s>maxBo)maxBo=s; } });
    elQd.firstChild ? (elQd.childNodes[0].nodeValue=qd) : (elQd.textContent=qd);
    setNum(elQd,qd); setNum(elIf,inflight); setNum(elRt,metrics.retries);
    setNum(elBk,metrics.blocked); setNum(elSc,metrics.succeeded);
    elBo.innerHTML=(maxBo>0?maxBo.toFixed(1):'0')+'<span class="u">s</span>';
    elBo.className='v '+(maxBo>0?'warn':'');
    var ovf=qd-QCAP; elOvf.textContent = ovf>0? '+'+ovf+' more' : '';
    // retry lane visibility
    var ret=document.getElementById('rl-retpath'), rl=document.getElementById('rl-retlbl');
    var on = backoff>0 || !apiOK;
    ret.setAttribute('opacity', on?'0.7':'0'); rl.setAttribute('opacity', on?'0.9':'0');
  }
  function setNum(el,v){ el.childNodes.length>1 ? (el.childNodes[0].nodeValue=v) : (el.textContent=v); }

  function setAPI(ok){
    apiOK=ok;
    var pill=document.getElementById('rl-apipill'), txt=document.getElementById('rl-apitext'), rect=document.getElementById('rl-apirect');
    if(ok){
      pill.setAttribute('fill','color-mix(in oklch,var(--grn) 16%,transparent)');
      pill.setAttribute('stroke','color-mix(in oklch,var(--grn) 40%,transparent)');
      txt.setAttribute('fill','var(--grn)'); txt.textContent='200';
      rect.setAttribute('stroke','var(--line2)');
    } else {
      pill.setAttribute('fill','color-mix(in oklch,var(--red) 18%,transparent)');
      pill.setAttribute('stroke','color-mix(in oklch,var(--red) 48%,transparent)');
      txt.setAttribute('fill','var(--red)'); txt.textContent='429';
      rect.setAttribute('stroke','color-mix(in oklch,var(--red) 40%,transparent)');
    }
    var segBtns=document.querySelectorAll('#rl-api button');
    segBtns.forEach(function(b){ b.setAttribute('data-on', (b.getAttribute('data-v')==='ok')===ok ? '1':'0'); });
  }

  // ---- controls ----
  document.getElementById('rl-burst').addEventListener('click',function(){ spawn(8); if(motionOff()) staticRender(); });
  document.querySelectorAll('#rl-api button').forEach(function(b){
    b.addEventListener('click',function(){ setAPI(b.getAttribute('data-v')==='ok'); if(motionOff()) staticRender(); });
  });

  // ---- motion / loop ----
  function motionOff(){ return window.__motionOff || (window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches); }
  var spawnAcc=0, last=0, raf=null;
  function loop(now){
    if(!last) last=now; var dt=Math.min(now-last,60); last=now;
    step(now,dt);
    raf=requestAnimationFrame(loop);
  }
  function start(){ if(raf) return; last=0; raf=requestAnimationFrame(loop); }
  function stop(){ if(raf){ cancelAnimationFrame(raf); raf=null; } }

  function staticRender(){
    // snapshot frame for reduced motion: snap positions, single step of layout
    var ql=queuedList();
    ql.forEach(function(t,i){ var col=i%3,rowi=Math.floor(i/3); t.x=300+col*34; t.y=120+rowi*30; });
    tokens.forEach(function(t){ if(t.el){ t.el.setAttribute('cx',t.x.toFixed(1)); t.el.setAttribute('cy',t.y.toFixed(1)); t.el.style.fill=colorFor(t);} });
    assignWorkers(); paintWorkers(); paintMetrics(ql.length);
  }

  function seedStatic(){
    spawn(9);
    // pre-place: some queued, fill workers
    tokens.forEach(function(t){ t.phase='queued'; });
    assignWorkers();
    tokens.forEach(function(t){ if(t.worker!=null){ t.phase='processing'; t.x=slots[t.worker].x; t.y=slots[t.worker].y; } });
    staticRender();
  }

  // expose for tweaks
  window.__taskitoDemos=window.__taskitoDemos||{};
  var prevMotion=window.__taskitoDemos.motion, prevRecolor=window.__taskitoDemos.recolor;
  window.__taskitoDemos.motion=function(off){ if(prevMotion)prevMotion(off); if(off){ stop(); staticRender(); } else { start(); } };
  window.__taskitoDemos.recolor=function(){ if(prevRecolor)prevRecolor(); /* svg uses var() inline, repaints automatically */ };

  setAPI(true);
  // start when visible (lazy) — but kick a static seed immediately
  if(motionOff()){ seedStatic(); }
  else {
    spawn(4);
    var io=new IntersectionObserver(function(es){ es.forEach(function(e){ if(e.isIntersecting){ start(); } else { /* keep running */ } }); },{threshold:0.05});
    io.observe(root);
    start();
  }
})();
