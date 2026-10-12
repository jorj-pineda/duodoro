import { dayTotals, type CalendarDay } from './focusCalendar';
import { FOCUS_TAGS, type FocusTagId } from './focusTags';

export type InsightPeriod = 'week' | 'month';

// Calendar arithmetic on date-only values: never subtract 24h across local DST.
export function insightDays(today: string, period: InsightPeriod): string[] {
  if (!today) return [];
  const end = new Date(`${today}T00:00:00Z`);
  const start = new Date(end);
  if (period === 'week') start.setUTCDate(start.getUTCDate() - 6);
  else start.setUTCDate(1);
  const days: string[] = [];
  for (const date = new Date(start); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    days.push(date.toISOString().slice(0, 10));
  }
  return days;
}

export function summarizeInsights(rows: CalendarDay[], days: string[]) {
  const byDay = new Map(rows.map(row => [row.day, row]));
  const daily = days.map(day => ({ day, ...dayTotals(byDay.get(day), 'all') }));
  const selected = days.flatMap(day => byDay.get(day) ? [byDay.get(day)!] : []);
  const soloSeconds = selected.reduce((sum, row) => sum + row.solo_seconds, 0);
  const duoSeconds = selected.reduce((sum, row) => sum + row.duo_seconds, 0);
  const seconds = soloSeconds + duoSeconds;
  const rounds = daily.reduce((sum, day) => sum + day.rounds, 0);
  const maximum = Math.max(0, ...daily.map(day => day.seconds));
  const tagTotals = new Map<FocusTagId | null, { seconds: number; rounds: number }>();
  // The RPC supplies the entire month, independent of calendar detail pagination.
  for (const row of selected) for (const session of row.sessions) {
    const total = tagTotals.get(session.private_tag) ?? { seconds: 0, rounds: 0 };
    total.seconds += session.focus_seconds;
    total.rounds++;
    tagTotals.set(session.private_tag, total);
  }
  const tags = [...FOCUS_TAGS.map(tag => ({ ...tag, ...(tagTotals.get(tag.id) ?? { seconds: 0, rounds: 0 }) })),
    { id: 'untagged', label: 'Untagged', ...(tagTotals.get(null) ?? { seconds: 0, rounds: 0 }) }];
  return {
    seconds, rounds, soloSeconds, duoSeconds, daily, tags,
    activeDays: daily.filter(day => day.rounds > 0).length,
    averageSeconds: rounds ? Math.floor(seconds / rounds) : 0,
    busiestDays: maximum > 0 ? daily.filter(day => day.seconds === maximum).map(day => day.day) : [],
  };
}

export function insightDate(day: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${day}T00:00:00Z`));
}
