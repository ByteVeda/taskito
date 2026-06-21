/* ============================================================
   taskito · Demo 03 — Worker scaling playground
   Sliders drive a stochastic queue simulation; throughput,
   queue-depth and latency charts respond live on Canvas 2D.
   Tier-1: Canvas 2D + requestAnimationFrame. No WebGL.
   ============================================================ */
(function(){
  var root=document.getElementById('wp-root');
  if(!root) return;

  var P={ workers:4, conc:2, lambda:18, jobMs:300, rate:0 }; // rate 0 = off
  var FIELDS=[
    {k:'workers', n:'Workers', sub:'pool size',     min:1, max:12, step:1, fmt:function(v){return v;}},
    {k:'conc',    n:'Concurrency', sub:'per worker', min:1, max:8,  step:1, fmt:function(v){return '×'+v;}},
    {k:'lambda',  n:'Arrival rate', sub:'jobs / s',  min:1, max:80, step:1, fmt:function(v){return v+'/s';}},
    {k:'jobMs',   n:'Avg job time', sub:'milliseconds',min:50, max:1200, step:25, fmt:function(v){return v+'ms';}},
    {k:'rate',    n:'Rate limit', sub:'0 = unlimited',min:0, max:60, step:2, fmt:function(v){return v===0?'off':v+'/s';}}
  ];

  root.innerHTML=
  '<div class="demo-bar">'+
    '<span class="title"><span class="ld"></span>worker-pool · simulation</span>'+
    '<div class="demo-controls">'+
      '<button class="ctl" id="wp-reset"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>Reset</button>'+
    '</div>'+
  '</div>'+
  '<div class="wp-grid">'+
    '<div class="wp-ctl" id="wp-fields"></div>'+
    '<div class="wp-charts">'+
      chart('throughput','Throughput','wp-c-thr','wp-v-thr','/s','var(--indigo-br)')+
      chart('queue','Queue depth','wp-c-q','wp-v-q','jobs','var(--amber)')+
      chart('latency','Latency (p50)','wp-c-lat','wp-v-lat','ms','var(--cyan)')+
    '</div>'+
  '</div>';

  function chart(id,title,cid,vid,unit,col){
    return '<div class="wp-chart"><div class="ch-hd"><span class="t"><i style="background:'+col+'"></i>'+title+'</span>'+
      '<span class="now" id="'+vid+'">0<span class="u">'+unit+'</span></span></div>'+
      '<canvas class="wp-canvas" id="'+cid+'"></canvas></div>';
  }

  // ---- build sliders ----
  var fieldsEl=document.getElementById('wp-fields');
  FIELDS.forEach(function(f){
    var wrap=document.createElement('div'); wrap.className='wp-field';
    wrap.innerHTML='<div class="lab"><span class="n">'+f.n+' <small>'+f.sub+'</small></span><span class="val" id="wp-val-'+f.k+'">'+f.fmt(P[f.k])+'</span></div>'+
      '<input type="range" class="wp-range" id="wp-rg-'+f.k+'" min="'+f.min+'" max="'+f.max+'" step="'+f.step+'" value="'+P[f.k]+'" aria-label="'+f.n+'">';
    fieldsEl.appendChild(wrap);
    var rg=wrap.querySelector('input');
    rg.addEventListener('input',function(){
      P[f.k]=+rg.value;
      document.getElementById('wp-val-'+f.k).textContent=f.fmt(P[f.k]);
      if(motionOff()) staticEval();
    });
  });
  var capEl=document.createElement('div'); capEl.className='wp-cap'; capEl.id='wp-cap'; fieldsEl.appendChild(capEl);

  document.getElementById('wp-reset').addEventListener('click',function(){
    P={workers:4,conc:2,lambda:18,jobMs:300,rate:0};
    FIELDS.forEach(function(f){ var rg=document.getElementById('wp-rg-'+f.k); rg.value=P[f.k]; document.getElementById('wp-val-'+f.k).textContent=f.fmt(P[f.k]); });
    N=0; reseed(); if(motionOff()) staticEval();
  });

  // ---- simulation ----
  var N=0;            // jobs in system
  var tokens=0;       // rate-limit token bucket
  var thrEMA=0, latEMA=0;
  var BUF=170;
  var hThr=new Array(BUF).fill(0), hQ=new Array(BUF).fill(0), hLat=new Array(BUF).fill(0);

  function poisson(mean){ // small-mean sampler (Knuth)
    if(mean<=0) return 0;
    if(mean>30) return Math.max(0,Math.round(mean+Math.sqrt(mean)*gauss()));
    var L=Math.exp(-mean),k=0,p=1;
    do{ k++; p*=Math.random(); }while(p>L);
    return k-1;
  }
  function gauss(){ var u=Math.random(),v=Math.random(); return Math.sqrt(-2*Math.log(u||1e-9))*Math.cos(6.283185*v); }

  function stepSim(dt){
    var C=P.workers*P.conc;
    var inService=Math.min(N,C);
    // arrivals
    var arr=poisson(P.lambda*dt);
    N+=arr;
    inService=Math.min(N,C);
    // rate-limit bucket
    var rl=P.rate>0;
    if(rl){ tokens=Math.min(P.rate, tokens+P.rate*dt); }
    // service completions ~ inService * dt / jobTime
    var svcMean=inService*dt/(P.jobMs/1000);
    var done=poisson(svcMean);
    done=Math.min(done, N);
    if(rl){ done=Math.min(done, Math.floor(tokens)); tokens-=done; }
    N-=done;
    // metrics
    var inst=dt>0?done/dt:0; // jobs/s this step
    thrEMA=thrEMA+(inst-thrEMA)*Math.min(1,dt*3.2);
    var q=Math.max(0,N-C);
    var lat = thrEMA>0.2 ? (N/thrEMA)*1000 : (N>0? 9000 : 0); // Little's law, ms
    latEMA=latEMA+(lat-latEMA)*Math.min(1,dt*2.2);
    push(thrEMA,q,latEMA);
  }
  function push(t,q,l){ hThr.push(t);hThr.shift(); hQ.push(q);hQ.shift(); hLat.push(l);hLat.shift(); }
  function reseed(){ hThr=new Array(BUF).fill(0);hQ=new Array(BUF).fill(0);hLat=new Array(BUF).fill(0);thrEMA=0;latEMA=0;tokens=P.rate; }

  // ---- chart drawing ----
  var cv={thr:cvs('wp-c-thr'),q:cvs('wp-c-q'),lat:cvs('wp-c-lat')};
  function cvs(id){ var c=document.getElementById(id); return {c:c,ctx:c.getContext('2d'),w:0,h:0}; }
  var probe=document.createElement('span'); probe.style.cssText='position:absolute;opacity:0;pointer-events:none'; document.body.appendChild(probe);
  function rgb(varexpr){ probe.style.color=varexpr; return getComputedStyle(probe).color; }
  var COLORS={};
  function refreshColors(){
    COLORS={ thr:rgb('var(--indigo-br)'), q:rgb('var(--amber)'), lat:rgb('var(--cyan)'),
             grid:rgb('var(--line)'), txt:rgb('var(--dim)') };
  }
  function sizeCanvas(o){
    var dpr=Math.min(2,window.devicePixelRatio||1);
    var w=o.c.clientWidth, h=o.c.clientHeight||84;
    o.w=w; o.h=h; o.c.width=w*dpr; o.c.height=h*dpr; o.ctx.setTransform(dpr,0,0,dpr,0,0);
  }
  function sizeAll(){ sizeCanvas(cv.thr);sizeCanvas(cv.q);sizeCanvas(cv.lat); }

  function drawChart(o,data,color,yMin,yMaxFloor){
    var ctx=o.ctx,w=o.w,h=o.h; ctx.clearRect(0,0,w,h);
    var pad=6, gh=h-pad*2;
    var max=yMaxFloor;
    for(var i=0;i<data.length;i++){ if(data[i]>max) max=data[i]; }
    max=max*1.18+0.001;
    // baseline grid
    ctx.strokeStyle=COLORS.grid; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(0,h-pad); ctx.lineTo(w,h-pad); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0,pad); ctx.lineTo(w,pad); ctx.globalAlpha=.5; ctx.stroke(); ctx.globalAlpha=1;
    var n=data.length, dx=w/(n-1);
    function X(i){return i*dx;} function Y(v){return pad+gh-(Math.min(v,max)/max)*gh;}
    // fill
    ctx.beginPath(); ctx.moveTo(0,h-pad);
    for(var i=0;i<n;i++){ ctx.lineTo(X(i),Y(data[i])); }
    ctx.lineTo(w,h-pad); ctx.closePath();
    var grad=ctx.createLinearGradient(0,pad,0,h);
    grad.addColorStop(0,withAlpha(color,.30)); grad.addColorStop(1,withAlpha(color,.02));
    ctx.fillStyle=grad; ctx.fill();
    // line
    ctx.beginPath();
    for(var i=0;i<n;i++){ var x=X(i),y=Y(data[i]); i?ctx.lineTo(x,y):ctx.moveTo(x,y); }
    ctx.strokeStyle=color; ctx.lineWidth=2; ctx.lineJoin='round'; ctx.stroke();
    // head dot
    var hx=X(n-1),hy=Y(data[n-1]);
    ctx.beginPath(); ctx.arc(hx,hy,3,0,6.2832); ctx.fillStyle=color; ctx.fill();
    ctx.beginPath(); ctx.arc(hx,hy,5.5,0,6.2832); ctx.strokeStyle=withAlpha(color,.4); ctx.lineWidth=1.5; ctx.stroke();
  }
  function withAlpha(rgbStr,a){ var m=rgbStr.match(/\d+/g); if(!m) return rgbStr; return 'rgba('+m[0]+','+m[1]+','+m[2]+','+a+')'; }

  function drawAll(){
    drawChart(cv.thr,hThr,COLORS.thr,0,8);
    drawChart(cv.q,hQ,COLORS.q,0,6);
    drawChart(cv.lat,hLat,COLORS.lat,0,400);
    // readouts
    setV('wp-v-thr', hThr[BUF-1].toFixed(1), '/s');
    setV('wp-v-q', Math.round(hQ[BUF-1]), 'jobs');
    setV('wp-v-lat', Math.round(hLat[BUF-1]), 'ms');
    paintCap();
  }
  function setV(id,val,u){ var e=document.getElementById(id); e.innerHTML=val+'<span class="u">'+u+'</span>'; }

  function paintCap(){
    var C=P.workers*P.conc;
    var svcCap=C/(P.jobMs/1000);
    var cap=P.rate>0?Math.min(svcCap,P.rate):svcCap;
    var verdict,vcls;
    if(cap>=P.lambda*1.12){ verdict='Keeping up — pool has headroom.'; vcls='good'; }
    else if(cap>=P.lambda*0.97){ verdict='Saturated — running near capacity.'; vcls='warn'; }
    else { verdict='Overloaded — queue is growing.'; vcls='bad'; }
    capEl.innerHTML='<b>'+C+'</b> in-flight slots · capacity <b>≈'+cap.toFixed(0)+'/s</b> vs demand <b>'+P.lambda+'/s</b>'+
      (P.rate>0?' · capped at '+P.rate+'/s':'')+
      '<span class="verdict '+vcls+'">'+verdict+'</span>';
  }

  // ---- loop ----
  function motionOff(){ return window.__motionOff || (window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches); }
  var raf=null,last=0;
  function loop(now){
    if(!last) last=now; var dt=Math.min((now-last)/1000,0.05); last=now;
    var sub=2; for(var i=0;i<sub;i++) stepSim(dt/sub*1.6);
    drawAll();
    raf=requestAnimationFrame(loop);
  }
  function start(){ if(raf||motionOff()) return; last=0; raf=requestAnimationFrame(loop); }
  function stop(){ if(raf){cancelAnimationFrame(raf);raf=null;} }

  function staticEval(){
    // fill buffers with steady-ish snapshot (no animation)
    reseed();
    for(var i=0;i<260;i++) stepSim(0.1);
    refreshColors(); sizeAll(); drawAll();
  }

  window.addEventListener('resize',function(){ sizeAll(); refreshColors(); drawAll(); });

  window.__taskitoDemos=window.__taskitoDemos||{};
  var pm=window.__taskitoDemos.motion, pr=window.__taskitoDemos.recolor;
  window.__taskitoDemos.motion=function(off){ if(pm)pm(off); if(off){ stop(); staticEval(); } else { reseed(); start(); } };
  window.__taskitoDemos.recolor=function(){ if(pr)pr(); refreshColors(); drawAll(); };
  // theme flips → recolor
  new MutationObserver(function(){ refreshColors(); drawAll(); }).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});

  // init
  requestAnimationFrame(function(){
    sizeAll(); refreshColors();
    if(motionOff()){ staticEval(); }
    else { reseed(); tokens=P.rate; start(); }
  });
})();
