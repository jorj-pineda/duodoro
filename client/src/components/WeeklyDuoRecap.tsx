"use client";
import { useWeeklyDuoRecap } from "@/hooks/useWeeklyDuoRecap";
import { formatDuration } from "@/lib/format";
export default function WeeklyDuoRecap({ userId, connected }: { userId: string; connected: boolean }) {
  const { rows, loaded, error, timezone, retry } = useWeeklyDuoRecap(userId, connected);
  return <section aria-label="Weekly duo recap" className="bg-surface border border-line rounded-xl p-4 space-y-3">
    <h2 className="font-semibold text-ink">Your week together</h2>
    <p className="text-xs text-muted">Completed duo rounds · Monday–Sunday{timezone ? ` · ${timezone}` : ""}</p>
    {error ? <p role="alert" className="text-sm text-danger">{error} <button className="min-h-11 px-2 underline" onClick={() => void retry()}>Retry weekly recap</button></p>
      : !loaded ? <p role="status" className="text-sm text-muted">Loading weekly recap…</p>
      : !rows.length ? <p className="text-sm text-muted">No completed duo rounds this week yet. Your next shared session starts the story.</p>
      : rows.map(row => <article key={row.partner_id} className="border-t border-line pt-3 space-y-1">
        <h3 className="text-sm font-semibold text-ink break-words">With {row.partner_name}</h3>
        <p className="text-xs text-muted">{row.week_start} – {row.week_end}</p>
        <p className="text-lg font-mono text-accent">{formatDuration(row.focus_seconds)} together</p>
        <p className="text-sm text-ink">{row.completed_rounds} {row.completed_rounds === 1 ? "round" : "rounds"} completed</p>
        <p className="text-xs text-muted">These rounds added {formatDuration(row.focus_seconds)} of saved focus toward each companion&apos;s growth.</p>
      </article>)}
    <p className="text-[11px] text-faint">Shared sessions only. Solo focus and private companion totals stay private.</p>
  </section>;
}
