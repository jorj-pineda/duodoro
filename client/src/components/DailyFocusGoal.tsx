"use client";
import { DAILY_GOALS, useDailyFocusGoal } from "@/hooks/useDailyFocusGoal";
import { formatDuration } from "@/lib/format";
import type { DailyFocus } from "@/lib/types";

interface Props {
  userId: string;
  today: string;
  dailyFocus: DailyFocus[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
}

export default function DailyFocusGoal({ userId, today, dailyFocus, loading, loaded, error }: Props) {
  const { goal, setGoal } = useDailyFocusGoal(userId);
  const seconds = dailyFocus.find((day) => day.day === today)?.focusSeconds ?? 0;
  const progress = Math.min(100, Math.max(0, Math.round(seconds / (goal * 60) * 100)));
  const ready = Boolean(today) && loaded && !loading && !error;
  return (
    <section aria-label="Daily focus goal" className="bg-surface border border-line rounded-xl p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink">Daily focus goal</h2>
        <label className="flex items-center gap-2 text-xs text-muted">
          Target
          <select aria-label="Daily focus target" value={goal} onChange={(event) => setGoal(Number(event.target.value))}
            className="bg-raise border border-line rounded px-2 py-1 text-ink">
            {DAILY_GOALS.map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}
          </select>
        </label>
      </div>
      {ready ? (
        <>
          <p role="status" className="text-sm text-ink">
            {formatDuration(seconds)} / {formatDuration(goal * 60)} today
            {seconds >= goal * 60 && <span className="text-accent font-semibold"> · Goal reached!</span>}
          </p>
          <div role="progressbar" aria-label="Today's focus goal" aria-valuemin={0} aria-valuemax={100}
            aria-valuenow={progress} aria-valuetext={`${formatDuration(seconds)} of ${formatDuration(goal * 60)}`}
            className="h-2 bg-raise rounded overflow-hidden">
            <div className="h-full bg-accent" style={{ width: `${progress}%` }} />
          </div>
        </>
      ) : <p role="status" className="text-xs text-muted">{error ? "Today's progress is unavailable. Retry your stats above." : "Loading today's progress…"}</p>}
      <p className="text-[11px] text-faint">Completed focus rounds count toward today. Target saved for this account on this browser.</p>
    </section>
  );
}
