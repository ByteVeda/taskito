import { useEffect, useRef } from "react";

// Interactive mesh work-stealing demo — faithful port of arch.js `meshdemo()`.
// The proven imperative animation runs inside one effect against a ref'd stage;
// React owns mount/cleanup (timers + resize listener + DOM). Client-only (no SSR),
// so the prerendered page ships an empty stage that hydrates here.

interface Region {
  code: string;
  city: string;
  lat: number;
  lng: number;
  off: [number, number];
}
interface Worker {
  el: HTMLDivElement;
  dot: HTMLSpanElement;
  region: Region;
  qEl: HTMLElement;
  nEl: HTMLElement;
  pulse: HTMLElement;
  jobs: number;
  x: number;
  y: number;
  cx: number;
  cy: number;
}
interface MeshLink {
  a: number;
  b: number;
  el: SVGPathElement;
  lab: HTMLDivElement;
  ms: number;
  geo?: { cx: number; cy: number; mx: number; my: number };
}

const REGIONS: Region[] = [
  {
    code: "us-east-1",
    city: "N. Virginia",
    lat: 38.9,
    lng: -77.0,
    off: [-2, 64],
  },
  { code: "us-west-2", city: "Oregon", lat: 45.5, lng: -122.7, off: [-6, -66] },
  { code: "eu-west-1", city: "Ireland", lat: 53.3, lng: -6.2, off: [6, 64] },
  { code: "ap-south-1", city: "Mumbai", lat: 19.0, lng: 72.8, off: [0, 66] },
  {
    code: "ap-northeast-1",
    city: "Tokyo",
    lat: 35.6,
    lng: 139.7,
    off: [-14, -60],
  },
];

const LANDS: [number, number][][] = [
  [
    [-140, 60],
    [-125, 49],
    [-123, 38],
    [-117, 32],
    [-97, 25],
    [-81, 25],
    [-80, 31],
    [-70, 44],
    [-60, 48],
    [-58, 52],
    [-78, 62],
    [-110, 60],
    [-140, 60],
  ],
  [
    [-10, 43],
    [-9, 37],
    [4, 40],
    [18, 41],
    [28, 41],
    [31, 46],
    [41, 48],
    [30, 60],
    [8, 58],
    [-6, 57],
    [-10, 50],
  ],
  [
    [-16, 14],
    [-9, 28],
    [11, 33],
    [25, 32],
    [34, 30],
    [43, 12],
    [48, 9],
    [40, 5],
    [14, 5],
    [-9, 6],
    [-16, 14],
  ],
  [
    [33, 46],
    [46, 40],
    [61, 38],
    [76, 33],
    [90, 24],
    [101, 22],
    [120, 31],
    [135, 35],
    [143, 45],
    [139, 52],
    [118, 53],
    [92, 55],
    [66, 55],
    [46, 52],
    [33, 46],
  ],
];

export function MeshDemo() {
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }
    const REDUCE =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const SVGNS = "http://www.w3.org/2000/svg";
    const H = 480;
    const N = REGIONS.length;
    let running = !REDUCE;
    let timers: ReturnType<typeof setInterval>[] = [];
    let completed = 0;
    let steals = 0;
    let stolenJobs = 0;
    let focus = -1;
    const workers: Worker[] = [];
    let links: MeshLink[] = [];

    const LNG0 = -150,
      LNG1 = 165,
      LAT0 = 5,
      LAT1 = 62,
      padX = 58,
      padTop = 66,
      padBot = 46;
    const proj = (lng: number, lat: number, W: number): [number, number] => {
      const mapW = W - padX * 2,
        mapH = H - padTop - padBot;
      return [
        padX + ((lng - LNG0) / (LNG1 - LNG0)) * mapW,
        padTop + ((LAT1 - lat) / (LAT1 - LAT0)) * mapH,
      ];
    };
    const haversine = (a: Region, b: Region) => {
      const R = 6371,
        toR = Math.PI / 180;
      const dLat = (b.lat - a.lat) * toR,
        dLng = (b.lng - a.lng) * toR,
        la1 = a.lat * toR,
        la2 = b.lat * toR;
      const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(h));
    };
    const latencyMs = (a: Region, b: Region) =>
      Math.round(haversine(a, b) / 95) + 6;
    const arc = (x0: number, y0: number, x1: number, y1: number) => {
      const mx = (x0 + x1) / 2,
        my = (y0 + y1) / 2,
        dx = x1 - x0,
        dy = y1 - y0,
        len = Math.hypot(dx, dy) || 1;
      const bow = -len * 0.16,
        cx = mx + (-dy / len) * bow,
        cy = my + (dx / len) * bow;
      return {
        cx,
        cy,
        mx: 0.25 * x0 + 0.5 * cx + 0.25 * x1,
        my: 0.25 * y0 + 0.5 * cy + 0.25 * y1,
      };
    };

    stage.innerHTML =
      '<div class="mesh-toolbar"><div class="mesh-stats">' +
      '<span class="mstat"><b id="m-done">0</b> completed</span>' +
      '<span class="mstat"><b id="m-steal">0</b> steals</span>' +
      '<span class="mstat"><b id="m-moved">0</b> moved · HTTP</span></div>' +
      `<div class="mesh-btns"><button class="mesh-btn" id="m-burst">+ Burst</button>` +
      '<button class="mesh-btn" id="m-reset">Reset</button>' +
      `<button class="mesh-btn" id="m-toggle">${running ? "Pause" : "Play"}</button></div></div>` +
      '<svg class="mesh-map" id="m-map" preserveAspectRatio="none"><g id="m-grat"></g><g id="m-land"></g><g id="m-links"></g><g id="m-conn"></g></svg>' +
      '<div class="mesh-legend"><span><i class="dot"></i>region node</span><span><i></i>mesh link (gossip)</span><span><i class="steal"></i>work-steal over HTTP</span></div>';

    const q = <T extends Element>(sel: string) => stage.querySelector(sel) as T;
    const mapSvg = q<SVGSVGElement>("#m-map");
    const gGrat = q<SVGGElement>("#m-grat");
    const gLand = q<SVGGElement>("#m-land");
    const gLinks = q<SVGGElement>("#m-links");
    const gConn = q<SVGGElement>("#m-conn");
    const setText = (sel: string, v: string) => {
      const el = q<HTMLElement>(sel);
      if (el) el.textContent = v;
    };

    const makeWorker = (i: number): Worker => {
      const r = REGIONS[i];
      const w = document.createElement("div");
      w.className = "mw";
      w.innerHTML =
        `<div class="mw-head"><span class="mw-pulse"></span><span class="mw-id">${r.code}</span><span class="mw-city">${r.city}</span></div>` +
        '<div class="mw-q"></div><div class="mw-load"><span class="mw-n">0</span> queued</div>';
      stage.appendChild(w);
      const dot = document.createElement("span");
      dot.className = "mnode";
      stage.appendChild(dot);
      w.addEventListener("mouseenter", () => setFocus(i));
      w.addEventListener("mouseleave", () => setFocus(-1));
      return {
        el: w,
        dot,
        region: r,
        qEl: w.querySelector(".mw-q") as HTMLElement,
        nEl: w.querySelector(".mw-n") as HTMLElement,
        pulse: w.querySelector(".mw-pulse") as HTMLElement,
        jobs: 0,
        x: 0,
        y: 0,
        cx: 0,
        cy: 0,
      };
    };

    const buildLinks = () => {
      gLinks.innerHTML = "";
      links = [];
      for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
          const p = document.createElementNS(SVGNS, "path");
          p.setAttribute("class", "link");
          gLinks.appendChild(p);
          const lab = document.createElement("div");
          lab.className = "mlat";
          stage.appendChild(lab);
          links.push({
            a: i,
            b: j,
            el: p,
            lab,
            ms: latencyMs(REGIONS[i], REGIONS[j]),
          });
        }
      }
    };
    const linkBetween = (i: number, j: number) =>
      links.find((L) => (L.a === i && L.b === j) || (L.a === j && L.b === i)) ??
      null;

    const layout = () => {
      stage.style.height = `${H}px`;
      const W = stage.clientWidth || 760;
      mapSvg.setAttribute("viewBox", `0 0 ${W} ${H}`);
      let g = "";
      for (let lng = -120; lng <= 150; lng += 30) {
        const a = proj(lng, LAT0, W),
          b = proj(lng, LAT1, W);
        g += `<line class="grat" x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}"/>`;
      }
      for (let lat = 10; lat <= 60; lat += 10) {
        const c = proj(LNG0, lat, W),
          d = proj(LNG1, lat, W);
        g += `<line class="grat" x1="${c[0].toFixed(1)}" y1="${c[1].toFixed(1)}" x2="${d[0].toFixed(1)}" y2="${d[1].toFixed(1)}"/>`;
      }
      gGrat.innerHTML = g;
      gLand.innerHTML = LANDS.map(
        (poly) =>
          `<polygon class="land" points="${poly
            .map((pt) => {
              const qp = proj(pt[0], pt[1], W);
              return `${qp[0].toFixed(1)},${qp[1].toFixed(1)}`;
            })
            .join(" ")}"/>`,
      ).join("");
      let conn = "";
      for (const w of workers) {
        const p = proj(w.region.lng, w.region.lat, W);
        w.x = p[0];
        w.y = p[1];
        w.dot.style.left = `${p[0]}px`;
        w.dot.style.top = `${p[1]}px`;
        const cxp = p[0] + w.region.off[0],
          cyp = p[1] + w.region.off[1];
        w.cx = cxp;
        w.cy = cyp;
        w.el.style.left = `${cxp}px`;
        w.el.style.top = `${cyp}px`;
        conn += `<line class="callout" x1="${p[0].toFixed(1)}" y1="${p[1].toFixed(1)}" x2="${cxp.toFixed(1)}" y2="${cyp.toFixed(1)}"/>`;
      }
      gConn.innerHTML = conn;
      for (const L of links) {
        const wa = workers[L.a],
          wb = workers[L.b],
          k = arc(wa.x, wa.y, wb.x, wb.y);
        L.el.setAttribute(
          "d",
          `M ${wa.x.toFixed(1)} ${wa.y.toFixed(1)} Q ${k.cx.toFixed(1)} ${k.cy.toFixed(1)} ${wb.x.toFixed(1)} ${wb.y.toFixed(1)}`,
        );
        L.geo = k;
        L.lab.textContent = `${L.ms} ms`;
        L.lab.style.left = `${k.mx}px`;
        L.lab.style.top = `${k.my}px`;
      }
    };

    const setFocus = (i: number) => {
      focus = i;
      if (i < 0) {
        mapSvg.classList.remove("focus");
        for (const L of links) {
          L.el.classList.remove("lit");
          L.lab.classList.remove("show");
        }
        return;
      }
      mapSvg.classList.add("focus");
      for (const L of links) {
        const on = L.a === i || L.b === i;
        L.el.classList.toggle("lit", on);
        L.lab.classList.toggle("show", on);
      }
    };

    const renderQueue = (w: Worker) => {
      const cap = 8,
        n = w.jobs,
        show = Math.min(n, cap);
      let html = "";
      for (let k = 0; k < show; k++) html += "<i></i>";
      if (n > cap) html += `<u>+${n - cap}</u>`;
      w.qEl.innerHTML = html;
      w.nEl.textContent = String(n);
      const hot = n >= 6;
      w.el.classList.toggle("hot", hot);
      w.el.classList.toggle("idle", n === 0);
      w.dot.classList.toggle("hot", hot);
    };

    const flyArc = (ai: number, bi: number, cls: string, cb?: () => void) => {
      const wa = workers[ai],
        wb = workers[bi],
        k = arc(wa.x, wa.y, wb.x, wb.y);
      const d = document.createElement("span");
      d.className = `mjob ${cls}`.trim();
      stage.appendChild(d);
      const frames: Keyframe[] = [];
      const steps = 18;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps,
          u = 1 - t;
        const x = u * u * wa.x + 2 * u * t * k.cx + t * t * wb.x;
        const y = u * u * wa.y + 2 * u * t * k.cy + t * t * wb.y;
        frames.push({
          transform: `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-50%)`,
          opacity: s === 0 || s === steps ? 0 : 1,
        });
      }
      d.animate(frames, { duration: 740, easing: "ease-in-out" }).onfinish =
        () => {
          d.remove();
          cb?.();
        };
    };

    const weightedTarget = () => {
      const r = Math.random();
      if (r < 0.5) return 0;
      if (r < 0.8) return 1;
      return 2 + Math.floor(Math.random() * (N - 2));
    };
    const spawn = (target?: number) => {
      const w = workers[target ?? weightedTarget()];
      if (!w) return;
      w.jobs++;
      renderQueue(w);
    };
    const process = () => {
      for (const w of workers) {
        if (w.jobs > 0 && Math.random() < 0.6) {
          w.jobs--;
          renderQueue(w);
          completed++;
          w.pulse.classList.remove("go");
          void w.pulse.offsetWidth;
          w.pulse.classList.add("go");
        }
      }
      setText("#m-done", String(completed));
    };
    const steal = () => {
      let total = 0,
        maxI = 0;
      workers.forEach((w, i) => {
        total += w.jobs;
        if (w.jobs > workers[maxI].jobs) maxI = i;
      });
      const max = workers[maxI];
      if (total === 0 || max.jobs < 2) return;
      const avg = total / N;
      const needy = workers
        .map((w, i) => ({ w, i }))
        .filter((o) => o.w !== max && o.w.jobs < avg)
        .sort((a, b) => a.w.jobs - b.w.jobs);
      if (!needy.length) return;
      const surplus = Math.max(1, Math.round(max.jobs - avg));
      const toMove = Math.min(surplus, max.jobs - 1, needy.length * 2, 5);
      let moved = 0;
      for (let k = 0; k < toMove; k++) {
        const tgt = needy[k % needy.length];
        max.jobs--;
        tgt.w.jobs++;
        renderQueue(max);
        renderQueue(tgt.w);
        const ti = tgt.i;
        const delay = k * 110;
        const L = linkBetween(maxI, ti);
        workers[ti].el.classList.add("thief");
        setTimeout(() => workers[ti].el.classList.remove("thief"), 700);
        if (L) {
          L.el.classList.add("on");
          setTimeout(() => L.el.classList.remove("on"), 760);
          L.lab.classList.add("show");
          setTimeout(() => {
            if (focus < 0) L.lab.classList.remove("show");
          }, 900);
        }
        setTimeout(() => flyArc(maxI, ti, "steal"), delay);
        moved++;
      }
      if (moved > 0) {
        steals++;
        stolenJobs += moved;
        setText("#m-steal", String(steals));
        setText("#m-moved", String(stolenJobs));
      }
    };
    const gossip = () => {
      if (!links.length) return;
      const L = links[Math.floor(Math.random() * links.length)];
      L.el.classList.add("on");
      setTimeout(() => L.el.classList.remove("on"), 600);
      flyArc(
        Math.random() < 0.5 ? L.a : L.b,
        Math.random() < 0.5 ? L.b : L.a,
        "gos",
      );
    };
    const reset = () => {
      completed = 0;
      steals = 0;
      stolenJobs = 0;
      setText("#m-done", "0");
      setText("#m-steal", "0");
      setText("#m-moved", "0");
      for (const w of workers) w.jobs = 0;
      workers[0].jobs = 7;
      workers[1].jobs = 4;
      workers.forEach(renderQueue);
    };
    const stop = () => {
      for (const t of timers) clearInterval(t);
      timers = [];
    };
    const start = () => {
      stop();
      timers.push(setInterval(() => running && spawn(), 380));
      timers.push(setInterval(() => running && process(), 720));
      timers.push(setInterval(() => running && steal(), 1100));
      timers.push(setInterval(() => running && gossip(), 760));
    };

    for (let i = 0; i < N; i++) workers.push(makeWorker(i));
    buildLinks();
    layout();
    window.addEventListener("resize", layout);

    q<HTMLButtonElement>("#m-burst").addEventListener("click", () => {
      for (let k = 0; k < 10; k++) setTimeout(() => spawn(), k * 70);
    });
    const toggle = q<HTMLButtonElement>("#m-toggle");
    toggle.addEventListener("click", () => {
      running = !running;
      toggle.textContent = running ? "Pause" : "Play";
    });
    q<HTMLButtonElement>("#m-reset").addEventListener("click", reset);

    if (!REDUCE) {
      workers[0].jobs = 7;
      workers[1].jobs = 4;
      workers.forEach(renderQueue);
      start();
    } else {
      workers[0].jobs = 5;
      workers[1].jobs = 3;
      workers[2].jobs = 1;
      workers.forEach(renderQueue);
    }

    return () => {
      stop();
      window.removeEventListener("resize", layout);
      stage.innerHTML = "";
    };
  }, []);

  return <div ref={stageRef} className="mesh-demo" />;
}
