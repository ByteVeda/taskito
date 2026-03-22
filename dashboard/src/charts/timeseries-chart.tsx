import { useEffect, useRef } from "preact/hooks";
import type { TimeseriesBucket } from "../api/types";

interface TimeseriesChartProps {
  data: TimeseriesBucket[];
}

export function TimeseriesChart({ data }: TimeseriesChartProps) {
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

    if (!data.length) {
      ctx.fillStyle = "rgba(139,149,165,0.4)";
      ctx.font = "12px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("No timeseries data", w / 2, h / 2);
      return;
    }

    const pad = { top: 12, right: 12, bottom: 32, left: 48 };
    const cw = w - pad.left - pad.right;
    const ch = h - pad.top - pad.bottom;

    const maxCount = Math.max(...data.map((d) => d.success + d.failure), 1);
    const barW = Math.max(3, cw / data.length - 2);
    const gap = Math.max(1, (cw - barW * data.length) / data.length);

    // Y-axis grid
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
      ctx.fillText(Math.round((maxCount * i) / 4).toString(), pad.left - 6, y + 3);
    }

    // Bars
    data.forEach((d, i) => {
      const x = pad.left + i * (barW + gap);
      const successH = (d.success / maxCount) * ch;
      const failureH = (d.failure / maxCount) * ch;

      // Success bar with rounded top
      ctx.fillStyle = "rgba(34,197,94,0.65)";
      ctx.beginPath();
      const successY = pad.top + ch - successH - failureH;
      ctx.roundRect(x, successY, barW, successH, [2, 2, 0, 0]);
      ctx.fill();

      // Failure bar stacked
      if (failureH > 0) {
        ctx.fillStyle = "rgba(239,68,68,0.65)";
        ctx.beginPath();
        ctx.roundRect(x, pad.top + ch - failureH, barW, failureH, [0, 0, 2, 2]);
        ctx.fill();
      }
    });

    // X-axis timestamps
    ctx.fillStyle = "rgba(139,149,165,0.5)";
    ctx.font = "10px -apple-system, sans-serif";
    ctx.textAlign = "center";
    const labelCount = Math.min(6, data.length);
    for (let i = 0; i < labelCount; i++) {
      const idx = Math.floor((i / (labelCount - 1 || 1)) * (data.length - 1));
      const d = new Date(data[idx].timestamp * 1000);
      const label = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
      const x = pad.left + idx * (barW + gap) + barW / 2;
      ctx.fillText(label, x, h - 10);
    }
  }, [data]);

  return (
    <div class="dark:bg-surface-2 bg-white rounded-xl shadow-sm dark:shadow-black/20 p-5 mb-6 border dark:border-white/[0.06] border-slate-200">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-sm font-medium dark:text-gray-300 text-slate-600">Throughput Over Time</h3>
        <div class="flex items-center gap-4 text-xs text-muted">
          <span class="flex items-center gap-1.5">
            <span class="inline-block w-2.5 h-2.5 rounded-sm bg-success/65" />
            Success
          </span>
          <span class="flex items-center gap-1.5">
            <span class="inline-block w-2.5 h-2.5 rounded-sm bg-danger/65" />
            Failure
          </span>
        </div>
      </div>
      <canvas ref={canvasRef} class="w-full" style={{ height: "220px" }} />
    </div>
  );
}
