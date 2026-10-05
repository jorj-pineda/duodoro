/** A presentation of the session hook's server-derived phase progress. */
export default function TimerProgress({ progress, phase }: {
  progress: number;
  phase: "focus" | "break";
}) {
  const bounded = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  // Reserve 100% for the actual endpoint instead of rounding up early.
  const percent = bounded === 1 ? 100 : Math.min(99, Math.floor(bounded * 100 + Number.EPSILON * 100));
  const label = phase === "break" ? "Break" : "Focus";
  return (
    <div className="w-full max-w-xs space-y-1.5">
      <div aria-hidden="true" className="flex justify-between gap-3 text-xs font-semibold">
        <span className="text-muted">{label} progress</span>
        <span className={`font-mono tabular-nums ${phase === "break" ? "text-calm" : "text-accent"}`}>{percent}%</span>
      </div>
      <div role="progressbar" aria-label={`${label} progress`} aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={percent} aria-valuetext={`${percent}% of ${label.toLowerCase()} completed`}
        className="h-3 border-2 border-line bg-bg overflow-hidden">
        <div className={`h-full transition-[width] duration-1000 ease-linear motion-reduce:transition-none ${phase === "break" ? "bg-calm" : "bg-accent"}`}
          style={{ width: `${bounded * 100}%` }} />
      </div>
    </div>
  );
}
