import { GROWN_AT_SECONDS, FULL_AT_SECONDS, petStageAt, type PetStage } from "@/lib/petLevel";
import { formatDuration } from "@/lib/format";

export default function CompanionGrowth({ seconds, grewTo, onRetry, onDismiss }: {
  seconds: number | null;
  grewTo: PetStage | null;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const known = typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0;
  const stage = known ? petStageAt(seconds) : null;
  const full = stage === "full";
  const start = stage === "grown" ? GROWN_AT_SECONDS : 0;
  const target = stage === "grown" ? FULL_AT_SECONDS : GROWN_AT_SECONDS;
  const progress = known ? Math.min(100, Math.max(0, Math.floor((seconds - start) / (target - start) * 100))) : 0;
  return (
    <section aria-label="Companion growth" className="w-full max-w-xs text-center space-y-1">
      {grewTo && <div role="status" className="text-xs font-bold text-go bg-go/10 border border-go/30 px-2 py-1">
        Your companion grew to {grewTo === "full" ? "Level 3 — fully grown!" : "Level 2!"}
        <button aria-label="Dismiss growth milestone" onClick={onDismiss} className="px-2 py-2 text-muted">×</button>
      </div>}
      {!known ? <p className="text-xs text-muted">Growth progress unavailable. <button onClick={onRetry} className="underline px-2 py-2">Retry growth</button></p> : (
        <>
          <p className="text-xs font-semibold text-ink">{full ? "Level 3 · Fully grown" : stage === "grown" ? "Level 2 · Grown" : "Level 1 · Young"}</p>
          {!full && <>
            <p className="text-[11px] text-muted">{formatDuration(Math.ceil((target - seconds) / 60) * 60)} until {stage === "grown" ? "Level 3" : "Level 2"}</p>
            <div role="progressbar" aria-label="Companion growth progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}
              aria-valuetext={`${formatDuration(seconds)} saved focus; next level at ${formatDuration(target)}`} className="h-1 bg-line overflow-hidden">
              <div className="h-full bg-go" style={{ width: `${progress}%` }} />
            </div>
          </>}
          <p className="text-[10px] text-faint">{formatDuration(seconds)} saved focus · Solo and duo rounds count</p>
        </>
      )}
    </section>
  );
}
