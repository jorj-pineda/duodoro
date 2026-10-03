"use client";
import type { RoundRecap as Recap } from "@/lib/sessionTypes";
import { formatDuration, formatTime } from "@/lib/format";
import { useDailyFocusGoal } from "@/hooks/useDailyFocusGoal";
import { useRecapProgress } from "@/hooks/useRecapProgress";

const saveLabels: Record<Recap["saveState"], string> = {
  saving: "Saving round…",
  saved: "Round saved",
  pending: "Save pending — today’s progress will update when saved.",
  unconfirmed: "Save unconfirmed — check History before counting this round.",
};

export default function RoundRecap({ recap, userId }: { recap: Recap; userId: string }) {
  const { goal } = useDailyFocusGoal(userId);
  const { seconds, error, retry } = useRecapProgress(userId, recap.round, recap.saveState);
  return (
    <section aria-label="Round recap" className="w-full max-w-xs border border-line bg-raise px-3 py-2 text-center space-y-1">
      <h2 className="text-sm font-bold text-ink">Round {recap.round} complete</h2>
      <p className="text-xs text-ink">{formatTime(recap.focusSeconds)} {recap.mode === "flow" ? "Flow" : "focus"} completed</p>
      <p role="status" className="text-xs text-muted">{saveLabels[recap.saveState]}</p>
      {error ? (
        <p className="text-xs text-muted">Today’s progress is unavailable. <button onClick={retry} className="underline px-2 py-2">Retry progress</button></p>
      ) : seconds === null ? (
        <p className="text-xs text-muted">Loading today’s progress…</p>
      ) : (
        <>
          <p className="text-xs text-muted">{formatDuration(seconds)} / {formatDuration(goal * 60)} saved today{seconds >= goal * 60 ? " · Goal reached!" : ""}</p>
          <div role="progressbar" aria-label="Today’s focus goal" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(seconds / (goal * 60) * 100))} aria-valuetext={`${formatDuration(seconds)} of ${formatDuration(goal * 60)} saved today`} className="h-1 bg-line overflow-hidden">
            <div className="h-full bg-go" style={{ width: `${Math.min(100, seconds / (goal * 60) * 100)}%` }} />
          </div>
        </>
      )}
    </section>
  );
}
