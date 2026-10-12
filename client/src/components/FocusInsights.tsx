"use client";
import { useState } from 'react';
import { useLocalDay } from '@/hooks/useDailyFocusGoal';
import { useFocusCalendar } from '@/hooks/useFocusCalendar';
import { focusTagKey, useSessionFocusTagCache } from '@/hooks/useSessionFocusTags';
import { focusLabel } from '@/lib/focusCalendar';
import { insightDate, insightDays, summarizeInsights, type InsightPeriod } from '@/lib/focusInsights';

export default function FocusInsights({ userId }: { userId: string }) {
  const today = useLocalDay();
  const [period, setPeriod] = useState<InsightPeriod>('week');
  const days = insightDays(today, period);
  const month = today.slice(0, 7);
  const earlierMonth = days[0]?.slice(0, 7) ?? '';
  const needsEarlier = earlierMonth !== month;
  const current = useFocusCalendar(userId, month);
  const earlier = useFocusCalendar(userId, needsEarlier ? earlierMonth : '');
  const loaded = current.loaded && (!needsEarlier || earlier.loaded);
  const error = current.error || (needsEarlier && earlier.error);
  const tagsAvailable = current.tagsAvailable && (!needsEarlier || earlier.tagsAvailable);
  const cache = useSessionFocusTagCache();
  const rows = [...current.rows, ...(needsEarlier ? earlier.rows : [])].map(row => ({
    ...row, sessions: row.sessions.map(session => {
      const saved = cache[focusTagKey(userId, session.id)];
      return saved && saved.version > (session.private_tag_version ?? 0)
        ? { ...session, private_tag: saved.tag, private_tag_version: saved.version } : session;
    }),
  }));
  const summary = summarizeInsights(rows, days);
  const retry = () => { void current.retry(); if (needsEarlier) void earlier.retry(); };
  const max = Math.max(1, ...summary.daily.map(day => day.seconds));

  return <section aria-label="Private focus insights" className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="font-display text-lg text-ink">Private focus insights</h2>
      <label className="text-xs text-muted">Period
        <select aria-label="Insights period" value={period} onChange={event => setPeriod(event.target.value as InsightPeriod)}
          className="ml-2 min-h-11 rounded-lg border border-line bg-surface px-2 text-ink">
          <option value="week">Last 7 days</option><option value="month">This month</option>
        </select>
      </label>
    </div>
    <p className="text-xs text-muted">Only you can see these insights and your tags. Includes your saved, completed solo and duo rounds.</p>
    {today && <p className="text-xs text-faint">{insightDate(days[0])}–{insightDate(today)} · {current.timezone ?? 'Your local timezone'}</p>}
    {error && <div role="alert" className="text-sm text-muted">
      {loaded ? "Couldn't refresh your insights. Showing the last loaded rounds." : "Couldn't load your insights. Try again."}
      <button onClick={retry} className="ml-2 min-h-11 px-2 font-bold text-accent">Retry insights</button>
    </div>}
    {!loaded && !error && <p role="status" className="text-sm text-muted">Loading insights…</p>}
    {loaded && <>
      {summary.rounds === 0 ? <p className="text-sm text-muted">No completed focus rounds in this period. Finish a round to see your insights.</p> : <>
        <dl className="grid grid-cols-2 gap-2">
          {[
            ['Completed focus', focusLabel(summary.seconds)], ['Completed rounds', String(summary.rounds)],
            ['Active days', `${summary.activeDays} of ${days.length}`], ['Average round', focusLabel(summary.averageSeconds)],
          ].map(([label, value]) => <div key={label} className="rounded-xl border border-line bg-surface p-3">
            <dt className="text-xs text-muted">{label}</dt><dd className="mt-1 font-mono font-bold text-ink">{value}</dd>
          </div>)}
        </dl>
        <div className="rounded-xl border border-line p-3 space-y-2">
          <h3 className="text-sm font-bold text-ink">Solo and duo focus</h3>
          <p className="text-xs text-muted">Solo: {focusLabel(summary.soloSeconds)} · Duo: {focusLabel(summary.duoSeconds)}</p>
          <div aria-hidden="true" className="flex h-3 overflow-hidden rounded bg-line">
            <div className="bg-accent" style={{ width: `${summary.soloSeconds / Math.max(1, summary.seconds) * 100}%` }} />
            <div className="bg-go" style={{ width: `${summary.duoSeconds / Math.max(1, summary.seconds) * 100}%` }} />
          </div>
        </div>
        <div className="rounded-xl border border-line p-3 space-y-3">
          <h3 className="text-sm font-bold text-ink">Daily focus</h3>
          <p className="text-xs text-muted">Busiest {summary.busiestDays.length === 1 ? 'day' : 'days'}: {summary.busiestDays.map(insightDate).join(', ') || 'No focus time yet'}</p>
          <ul className="space-y-2" aria-label="Daily completed focus">
            {summary.daily.map(day => <li key={day.day} className="grid grid-cols-[4rem_1fr_4rem] items-center gap-2 text-xs">
              <span className="text-muted">{insightDate(day.day)}</span>
              <span aria-hidden="true" className="h-2 rounded bg-line"><span className="block h-full rounded bg-accent" style={{ width: `${day.seconds / max * 100}%` }} /></span>
              <span className="text-right font-mono text-ink">{focusLabel(day.seconds)}</span>
            </li>)}
          </ul>
        </div>
        <div className="rounded-xl border border-line p-3 space-y-2">
          <h3 className="text-sm font-bold text-ink">Your private tags</h3>
          {tagsAvailable ? <ul aria-label="Focus by private tag" className="space-y-2">
            {summary.tags.filter(tag => tag.rounds > 0).map(tag => <li key={tag.id} className="flex justify-between gap-2 text-xs">
              <span className="text-muted">{tag.label}</span><span className="font-mono text-ink">{focusLabel(tag.seconds)} · {tag.rounds} {tag.rounds === 1 ? 'round' : 'rounds'}</span>
            </li>)}
          </ul> : <p className="text-xs text-muted">Private tags are unavailable. Focus totals still include all completed rounds.</p>}
        </div>
      </>}
    </>}
  </section>;
}
