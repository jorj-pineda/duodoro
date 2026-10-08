"use client";
import { useSharedMilestones } from "@/hooks/useSharedMilestones";
import { sharedMilestones, sharedFocusLabel, type SharedFocus, type SharedMilestone } from "@/lib/sharedMilestones";
import { StarIcon } from "./Icons";

function NextMilestone({ milestone, total }: { milestone: SharedMilestone; total: SharedFocus }) {
  const amount = total[milestone.metric];
  const percent = Math.min(99, Math.floor(amount / milestone.target * 100));
  const description = milestone.metric === "rounds" ? `${amount} / ${milestone.target} completed rounds` : `${sharedFocusLabel(amount)} / ${sharedFocusLabel(milestone.target)} shared focus`;
  return <div className="space-y-1">
    <p className="text-xs text-ink">Next: {milestone.label}</p>
    <div role="progressbar" aria-label={`${milestone.label} with ${total.partnerName}`} aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={percent} aria-valuetext={description} className="h-2 bg-line overflow-hidden">
      <div className="h-full bg-accent" style={{ width: `${percent}%` }} />
    </div>
    <p className="text-[11px] text-muted">{description}</p>
  </div>;
}

export default function SharedMilestones({ userId, connected }: { userId: string; connected: boolean }) {
  const { rows, loaded, error, retry } = useSharedMilestones(userId, connected);
  return <section aria-label="Shared milestones" className="bg-surface border border-line rounded-xl p-4 space-y-3">
    <h2 className="font-display text-lg text-ink">Milestones together</h2>
    <p className="text-xs text-muted">Small celebrations for your completed, saved duo rounds. No streak to keep up.</p>
    {error ? <p role="alert" className="text-sm text-danger">{error} <button className="min-h-11 underline" onClick={() => void retry()}>Retry milestones</button></p>
      : !loaded ? <p role="status" className="text-sm text-muted">Loading shared milestones…</p>
      : !rows.length ? <p className="text-sm text-muted">Complete a duo round to start milestones together.</p>
      : rows.map(total => {
        const { achieved, nextRounds, nextHours } = sharedMilestones(total);
        return <article key={total.partnerId} className="border-t border-line pt-3 space-y-3">
          <h3 className="text-sm font-semibold text-ink break-words">With {total.partnerName}</h3>
          <p className="text-xs text-muted">{total.rounds} completed {total.rounds === 1 ? "round" : "rounds"} · {sharedFocusLabel(total.seconds)} together</p>
          <div><h4 className="text-[11px] font-semibold text-muted mb-2">Achieved together</h4>
            <ul className="flex flex-wrap gap-2" aria-label={`Achieved with ${total.partnerName}`}>
              {achieved.map(milestone => <li key={milestone.id} className="flex items-center gap-1.5 px-2 py-1.5 border border-gold bg-gold/10 text-xs text-ink">
                <StarIcon className="w-3 h-3 text-gold" />{milestone.label}
              </li>)}
            </ul>
          </div>
          {nextRounds && <NextMilestone milestone={nextRounds} total={total} />}
          {nextHours && <NextMilestone milestone={nextHours} total={total} />}
          {!nextRounds && !nextHours && <p className="text-xs text-muted">Every milestone reached. Here&apos;s to more time together.</p>}
        </article>;
      })}
    <p className="text-[11px] text-faint">Shared duo sessions only. Each person&apos;s solo focus stays private.</p>
  </section>;
}
