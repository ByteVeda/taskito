interface ProgressBarProps {
  progress: number | null;
}

export function ProgressBar({ progress }: ProgressBarProps) {
  if (progress == null) {
    return <span class="text-muted text-xs">{"\u2014"}</span>;
  }
  return (
    <span class="inline-flex items-center gap-2">
      <span class="inline-block w-16 h-1.5 rounded-full dark:bg-white/[0.08] bg-slate-200 overflow-hidden">
        <span
          class="block h-full rounded-full bg-gradient-to-r from-accent to-accent-light transition-[width] duration-300"
          style={{ width: `${progress}%` }}
        />
      </span>
      <span class="text-xs tabular-nums text-muted">{progress}%</span>
    </span>
  );
}
