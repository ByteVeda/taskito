import { useRef, useEffect } from "preact/hooks";
import { TrendingUp } from "lucide-preact";

interface ThroughputChartProps {
  data: number[];
}

export function ThroughputChart({ data }: ThroughputChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const w = rect.width;
    const h = rect.height;

    ctx.clearRect(0, 0, w, h);

    if (data.length < 2) {
      ctx.fillStyle = "rgba(139,149,165,0.4)";
      ctx.font = "12px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Collecting data\u2026", w / 2, h / 2);
      return;
    }

    const max = Math.max(...data, 1);
    const pad = { top: 12, right: 12, bottom: 24, left: 44 };
    const cw = w - pad.left - pad.right;
    const ch = h - pad.top - pad.bottom;

    // Grid lines
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + ch * (1 - i / 4);
      ctx.strokeStyle = "rgba(255,255,255,0.04)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(w - pad.right, y);
      ctx.stroke();
      ctx.fillStyle = "rgba(139,149,165,0.5)";
      ctx.font = "10px -apple-system, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(((max * i) / 4).toFixed(1), pad.left - 6, y + 3);
    }

    // Gradient fill
    const gradient = ctx.createLinearGradient(0, pad.top, 0, pad.top + ch);
    gradient.addColorStop(0, "rgba(34,197,94,0.2)");
    gradient.addColorStop(1, "rgba(34,197,94,0.01)");

    ctx.beginPath();
    ctx.moveTo(pad.left, pad.top + ch);
    data.forEach((v, i) => {
      const x = pad.left + (i / (data.length - 1)) * cw;
      const y = pad.top + ch * (1 - v / max);
      ctx.lineTo(x, y);
    });
    ctx.lineTo(pad.left + cw, pad.top + ch);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // Line
    ctx.beginPath();
    data.forEach((v, i) => {
      const x = pad.left + (i / (data.length - 1)) * cw;
      const y = pad.top + ch * (1 - v / max);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = "#22c55e";
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.stroke();

    // Current value dot
    if (data.length > 0) {
      const lastX = pad.left + cw;
      const lastY = pad.top + ch * (1 - data[data.length - 1] / max);
      ctx.beginPath();
      ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
      ctx.fillStyle = "#22c55e";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(lastX, lastY, 5, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(34,197,94,0.3)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }, [data]);

  const current = data.length > 0 ? data[data.length - 1] : 0;

  return (
    <div class="dark:bg-surface-2 bg-white rounded-xl shadow-sm dark:shadow-black/20 p-5 mb-6 border dark:border-white/[0.06] border-slate-200">
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-2">
          <TrendingUp class="w-4 h-4 text-success" strokeWidth={2} />
          <h3 class="text-sm font-medium dark:text-gray-300 text-slate-600">Throughput</h3>
        </div>
        <span class="text-xl font-bold tabular-nums text-success">{current.toFixed(1)} <span class="text-xs font-normal text-muted">jobs/s</span></span>
      </div>
      <canvas ref={canvasRef} class="w-full" style={{ height: "180px" }} />
    </div>
  );
}
